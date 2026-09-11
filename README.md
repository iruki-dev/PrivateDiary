# PrivateDiary

제로 지식 암호화 일기장. 서버(Firebase, Vercel)는 어떤 시점에도 평문이나 복호화 키를 볼 수 없다. 전체 설계는 `ARCHITECTURE.md`(로컬 전용, git에는 커밋되지 않음)를 참조.

## 개발 환경

```bash
pnpm install
cp .env.example .env.local   # Firebase 콘솔의 웹 앱 설정값을 채워 넣는다
pnpm dev          # 개발 서버 (http://localhost:3000)
pnpm test         # lib/crypto 단위 테스트 (Vitest)
pnpm test:rules   # Firestore 보안 규칙 테스트 (로컬 에뮬레이터, Java 필요)
pnpm lint         # ESLint
pnpm exec tsc --noEmit   # 타입 체크
pnpm build        # 프로덕션 빌드
```

## 디렉터리 구조

```
lib/
  crypto/          # 모든 암호화·복호화·키 파생 로직. 네트워크/Firebase를 일절 import하지 않는
                    # 순수 함수 모듈. 다른 코드는 반드시 lib/crypto/index.ts를 통해서만 이
                    # 모듈의 기능을 사용한다 (감사 용이성 확보를 위한 단일 진입점).
    index.ts       # 공개 API 배럴 — 이 파일 외부에서 개별 파일을 직접 import하지 않는다
    constants.ts   # 알고리즘 버전 태그, KDF 반복 횟수 등 상수
    errors.ts      # WrongPassphraseError / TamperedCiphertextError / InvalidShamirSharesError
    types.ts       # 바이트 기반 타입(HybridKeyPair 등) + Firestore 저장용 base64 타입
    encoding.ts    # 의존성 없는 base64/base64url 인코딩
    memory.ts       # wipeBytes() — 세션 종료 시 키 폐기용
    aesGcm.ts        # Web Crypto AES-GCM 래퍼 (이 프로젝트에서 AES-GCM을 다루는 유일한 지점)
    random.ts         # generateMasterSeed()
    subSeeds.ts        # HKDF로 X25519/ML-KEM 하위 시드 파생
    keys.ts             # deriveHybridKeyPair() — 시드로부터 결정론적 키 쌍 재구성
    passphrase.ts        # wrapSeed / unwrapSeed / rewrapSeed (PBKDF2 + AES-GCM)
    recovery.ts            # Shamir 비밀 분산 — 니모닉 대체이자 패스프레이즈와 동등한 자격의
                            # 유일한 대안. 조각은 시드가 아니라 무작위 AES 래핑 키를 쪼개고,
                            # 그 키로 시드를 wrap한 결과(ShamirWrappedSeed)를 저장한다 —
                            # 그래야 재발급이 옛 조각을 실제로 무효화한다. 복원 성공 여부는
                            # AES-GCM 인증 태그로 판별(passphrase.ts의 WrongPassphraseError와
                            # 동일한 패턴)
    hybridKem.ts             # encapsulateContentKey / decapsulateContentKey (X25519+ML-KEM-768)
    entry.ts                  # encryptEntry / decryptEntry (일기 항목 단위)
    codec.ts                   # 위 타입들의 base64 Firestore 저장 변환 (암호화 로직 없음)
    __tests__/                  # Vitest 단위 테스트

  firebase/          # Firebase Auth(이메일/비밀번호 + Google) / Firestore 클라이언트 연동.
                      # 평문·키를 다루지 않고, lib/crypto의 공개 API만 호출한다.
    config.ts, auth.ts, users.ts, entries.ts
    otp.ts             # functions/의 OTP callable 래퍼. 여기도 크립토 없음 — 접근 게이트일 뿐.

  passphraseStrength.ts   # zxcvbn-ts 강도 추정 (lib/crypto 밖 — 암호화 연산이 아닌 UX 휴리스틱)

contexts/
  AuthContext.tsx    # Firebase 로그인 상태만 추적
  OtpContext.tsx      # OTP 활성화 여부/이번 세션 인증 여부를 ID 토큰 커스텀 클레임에서 추적.
                       # AuthContext와 SeedContext 사이에 위치 (로그인 이후, 시드 상태 이전 게이트)
  SeedContext.tsx     # 시드 상태(미발급/잠김/해제됨) + Shamir 설정 여부를 추적.
                       # unlock/lock/changePassphrase/resetKeys 외에, Shamir 설정/재발급을
                       # 위한 stage/prepare/confirm 3단계 API와 resetPassphraseWithShamirShares
                       # 보유 (패스프레이즈·Shamir 어느 쪽으로도 서로를 관리 가능 — 아래 참조)

components/
  SecretReveal.tsx              # "한 번만 보여주고 다시 못 봄" 공용 스캐폴드 (Shamir 조각에 재사용)
  SecretCard.tsx                 # 복호화 비밀 하나를 QR + 텍스트 + 다운로드로 표시
  OtpGate.tsx                     # OTP 활성화 시 코드 입력 전까지 children을 가리는 래퍼 (/entries에서 사용)
  OtpQrCard.tsx                    # OTP 설정용 QR(otpauth:// URI) + 수동 입력 코드 표시
  PassphraseStrengthMeter.tsx

app/                  # Next.js App Router 페이지
  login/, signup/, settings/, write/, entries/

functions/             # Firebase Cloud Functions — 이 프로젝트에서 유일한 서버 로직.
                        # OTP 코드 검증만 담당하고 시드·개인키·평문은 절대 다루지 않는다.
                        # startOtpSetup / confirmOtpSetup / verifyOtp / disableOtp
                        # (자세한 설계 근거는 functions/src/index.ts 모듈 주석 참조)

firestore.rules, firestore.indexes.json, firebase.json, .firebaserc
  Firestore 보안 규칙 및 에뮬레이터 설정 (ARCHITECTURE.md §5)

proxy.ts               # 요청마다 CSP nonce를 발급하는 Next.js Proxy(옛 middleware)
```

## 절대 규칙

이 저장소에서 작업할 때 지켜야 할 제약은 `ARCHITECTURE.md`에 정의되어 있다. 특히:

- 마스터 시드·개인키는 어떤 네트워크 요청/로그에도 포함되지 않는다.
- 서버(Vercel/Cloud Functions 포함) 코드에는 복호화 로직이 존재하지 않는다. `functions/`(OTP 검증)이 이 프로젝트의 유일한 서버 코드인데, 시드·개인키·평문 중 어느 것도 절대 보지 않는다 — 접근을 게이트할 뿐 무엇을 암호화하거나 복호화하지 않는다. `proxy.ts`는 보안 헤더만 설정하고 크립토/Firebase 코드를 일절 import하지 않는다.
- 모든 암호화 연산은 `lib/crypto/`를 통해서만 수행한다.

## 일기 복호화 방법

원래 설계(ARCHITECTURE.md §3.1)의 BIP39 24단어 니모닉은 제거했다. 이후 독립적으로 켜고 끄는 복수의 "복구 방법"(복구 키 + Shamir, OR로 결합) 모델을 거쳐, 지금은 **패스프레이즈와 Shamir 비밀 분산 두 가지만 남기고, 이 둘을 완전히 동등한 자격("상호보안적")으로** 만들었다.

- **패스프레이즈 (항상 켜져 있음)** — 평소에 쓰는 기본 방법. 끌 수 없다.
- **Shamir 비밀 분산 (opt-in)** — `shamir-secret-sharing`(Cure53·Zellic 감사 완료, WASM 없음)으로 N개 조각을 만들고 K개 이상 모아야 복원. **조각이 직접 시드를 쪼개진 않는다** — 무작위로 생성한 AES-256 래핑 키를 쪼개고, 그 키로 시드를 AES-GCM wrap한 결과(`decryptionMethods.shamir.wrappedSeed`)를 Firestore에 저장한다(패스프레이즈가 `wrappedSeed`를 wrap하는 것과 같은 구조). `(n, k)`와 이 wrap 결과만 저장되고, 조각 자체·래핑 키는 서버에 전혀 남지 않는다.

둘 중 **어느 쪽을 알고 있어도** 다음 세 가지를 모두 할 수 있다:

1. 일기를 복호화한다 (`unlock` / `unlockWithShamirShares`).
2. 패스프레이즈를 재설정한다 (`changePassphrase`는 기존 패스프레이즈로, `resetPassphraseWithShamirShares`는 K개의 Shamir 조각으로 — 어느 쪽이든 시드 자체는 그대로이므로 기존 일기와 이미 발급된 Shamir 조각이 계속 유효하다).
3. Shamir 조각을 새로 만들거나 재발급한다 (`prepareShamir`/`confirmPendingShamir` — 어느 쪽으로 증명했든 같은 동작).

단, **어느 한쪽을 안다고 해서 다른 쪽의 실제 값을 알아낼 수는 없다** — 구조적으로 보장된다. Shamir 조각을 복원해도 얻는 건 시드뿐, 패스프레이즈 문자열은 애초에 시드로부터 유도되지 않으므로 알아낼 수 없다. 패스프레이즈로 시드를 풀어도 이미 발급된 Shamir 조각의 실제 값은 알 수 없다.

**재발급은 실제로 이전 것을 무효화한다(단순히 "새 조각을 추가로 내주는" 게 아니다).** 위의 래핑 키 wrap 구조 덕분에, Shamir를 재발급하면 새 래핑 키로 시드를 다시 wrap해 Firestore의 `wrappedSeed` 값을 완전히 교체한다 — 이전 조각들은 (수학적으로는 여전히 유효한 옛 래핑 키를 복원하지만) 그 키로 열 수 있는 암호문이 더 이상 존재하지 않으므로 무력화된다. 시드를 직접 쪼개기만 했다면 재발급이 옛 조각을 결코 무효화하지 못했을 것이다(수학적으로 같은 비밀을 계속 복원하므로) — 이게 바로 애초에 이 래핑 키 계층을 둔 이유다. 패스프레이즈 재설정도 같은 원리로 이미 안전하다(`wrapSeed`가 매번 새 salt로 wrap하므로 옛 패스프레이즈는 교체된 `wrappedSeed`를 열 수 없다). 두 경로 모두 시드 자체와 `entries`(append-only)는 전혀 건드리지 않으므로, 자격 증명을 교체해도 모든 일기가 그대로 읽힌다.

평소에는 패스프레이즈만 쓰고, 그것을 잊어버렸을 때 비로소 Shamir가 비상 수단으로 쓰인다. Shamir로 복구한 뒤에는 새 패스프레이즈를 설정하길 권장한다(강제는 아님). 반대로 Shamir 조각을 잃어버렸다면 패스프레이즈로 새 조각을 재발급하면 된다. 재구성이 진짜인지는 별도 검증 데이터 없이 AES-GCM의 인증 태그 자체로 판별한다(`combineSeedShamir`가 wrap된 시드를 복호화하는 데 실패하면 `InvalidShamirSharesError`) — 패스프레이즈 경로가 `unwrapSeed`의 AES-GCM 인증 실패를 그대로 신호로 쓰는 것과 동일한 패턴이다.

패스프레이즈와 Shamir를 **둘 다** 잃어버린 경우에만 `/settings`의 "초기화"(브랜드 뉴 시드 발급, 기존 일기 전부 영구 손실)가 남는다.

> **마이그레이션 주의**: 이 래핑 키 indirection 이전에 Shamir를 설정해둔 계정은 Firestore에 `wrappedSeed` 없이 `{n, k}`만 있는 옛 형태로 저장되어 있다. 그런 계정은 Shamir로 잠금 해제/재설정을 시도하기 전에 **한 번 재발급**해야 한다(패스프레이즈로 증명 후 `/settings`에서 재발급).

## OTP 인증 (접근 게이트, 암호화 요인 아님)

`/settings`에서 OTP(구글 OTP 등 인증 앱)를 켜면, `entries` 컬렉션을 읽을 때(=일기를 볼 때) 서버가 검증한 OTP 코드가 최근 12시간 내에, 그리고 **현재 로그인 세션에서** 있어야 한다. **이건 시드를 감싸는 암호학적 키 조합이 아니다** — 6자리 회전 코드는 엔트로피가 너무 낮아 키 재료로 쓸 수 없고, 원본 TOTP 시크릿을 매번 다시 입력하게 하면 OTP 특유의 사용성이 사라진다. 대신 Bitwarden 등 다른 제로 지식 서비스들이 쓰는 것과 같은 패턴을 썼다: **금고 자체(시드 암호화)는 여전히 완전한 제로 지식이고, OTP는 그 위에 얹힌 서버 검증 접근 게이트**다.

- TOTP 시크릿은 `functions/`(Cloud Functions, Admin SDK)만 만들고 저장한다 — `otpSecrets/{uid}`는 `firestore.rules`에서 클라이언트에 완전히 차단.
- 코드가 맞으면 Cloud Function이 Firebase Auth ID 토큰에 `otpEnabled` / `otpVerified` / `otpVerifiedAt` 커스텀 클레임을 심고, `firestore.rules`의 `otpSatisfied()`가 `entries` 읽기에서 이를 요구한다.
- **`otpVerifiedAt`은 반드시 이번 세션의 `auth_time`(로그인 시각, ID 토큰의 표준 클레임) 이후여야 한다.** 커스텀 클레임은 특정 기기/세션이 아니라 Firebase Auth 계정 자체에 붙기 때문에, 이 조건이 없으면 기기 A에서 OTP를 인증한 뒤 12시간 안에 기기 B에서 새로 로그인해도 B의 ID 토큰이 A의 인증 상태를 그대로 물려받아 OTP를 한 번도 입력하지 않고 통과해버린다 — 실사용 중 발견되어 수정된 버그. `auth_time`은 로그인 시점에 고정되고 토큰 갱신으로는 바뀌지 않으므로, 같은 세션 안에서 페이지를 돌아다니는 것만으로 재인증을 요구하지는 않는다.
- `users/{uid}` 읽기는 OTP로 게이트하지 **않는다** — `publicKeys`가 있어야 쓰기가 되는데, 쓰기는 잠금 여부와 무관하게 항상 가능해야 하기 때문(ARCHITECTURE.md §3.2 규칙 5).
- 활성화는 QR 스캔 + 코드 1회 확인, 비활성화는 현재 유효한 코드가 있어야 함.
- 6자리 코드의 낮은 엔트로피 때문에 Cloud Function에 실패 5회당 60초 잠금을 넣었다 — 없으면 유효한 로그인 세션을 가진 공격자가 무차별 대입할 수 있다.

## 일기 잠금 해제 상태의 수명

패스프레이즈(또는 Shamir)로 잠금을 해제하면 파생된 개인키는 `SeedContext`(앱 전체를 감싸는 React Context)의 메모리에만 존재하고 — 쿠키, `localStorage`, 서버 등 어디에도 절대 저장되지 않는다(ARCHITECTURE.md rule 6). 다만 `SeedContext`가 앱 전체 수명 동안 유지되는 Provider이므로, 아무 조치가 없다면 한 번 해제한 키가 `/write`나 `/settings`로 이동했다가 `/entries`로 돌아와도 그대로 메모리에 남아 있어 패스프레이즈를 다시 묻지 않는 문제가 있었다(실사용 중 발견되어 수정된 버그). 지금은 `/entries` 페이지를 벗어날 때(언마운트 시) 항상 `lock()`을 호출해 개인키를 메모리에서 지운다 — `/entries`를 다시 열 때마다 매번 새로 잠금 해제해야 한다.

## Firestore 규칙 / Cloud Functions 배포

이 세션에서는 `firebase login`(브라우저 OAuth 필요)을 실행할 수 없어 아래는 사람이 직접 해야 한다.

```bash
firebase login
pnpm exec firebase deploy --only firestore:rules,firestore:indexes,functions --project <project-id>
```

- `firestore.rules`는 로컬 에뮬레이터로 이미 검증되어 있다 (`pnpm test:rules`).
- **Cloud Functions는 Firebase Blaze(종량제) 요금제가 필요하다** — Spark(무료) 요금제에서는 배포되지 않는다. Firebase 콘솔에서 결제 계정을 연결해 Blaze로 전환한 뒤 배포할 것. 이 앱 규모(개인용, 월 수십~수백 건의 OTP 검증)에서는 Cloud Functions 무료 한도(월 200만 건 호출) 안에 들어올 가능성이 높다.
- `functions/`는 루트와 별도로 `npm install`한다 (Cloud Functions 배포 단위 관례) — `cd functions && npm install`.

## Vercel 배포

1. GitHub 저장소를 Vercel 프로젝트에 연결 (vercel.com에서 "Import Project").
2. Vercel 프로젝트 설정 > Environment Variables에 `.env.example`의 6개 `NEXT_PUBLIC_FIREBASE_*` 값을 등록 (Production/Preview/Development 모두).
3. **Firebase 콘솔 > Authentication > Settings > Authorized domains에 Vercel 배포 도메인을 추가해야 로그인이 동작한다** (`*.vercel.app` 프리뷰 도메인 포함, 커스텀 도메인 사용 시 그것도 추가).
4. Next.js 앱(Vercel에 배포되는 쪽) 자체는 여전히 전부 클라이언트 사이드 Firebase SDK 호출만 하므로 Vercel 쪽에는 시크릿 환경변수가 전혀 없다. 서버 로직(OTP 검증)은 Vercel이 아니라 Firebase Cloud Functions에서 별도로 돌아간다 — 위 "Firestore 규칙 / Cloud Functions 배포" 참조.

## 보안 헤더 / CSP

`next.config.ts`에 정적 헤더(HSTS, X-Frame-Options 등), `proxy.ts`에 요청마다 새로 발급하는 CSP nonce가 있다. Next.js App Router의 하이드레이션 스크립트에 nonce를 붙이려면 페이지가 요청마다 렌더링되어야 하므로 `app/layout.tsx`에 `export const dynamic = "force-dynamic"`을 설정했다 (이 앱은 서버 데이터 의존성이 없는 클라이언트 앱이라 정적 생성의 이점이 크지 않고, 개인용 규모에서 요청마다 렌더링하는 비용은 무시할 만하다).
