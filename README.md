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
    recovery.ts            # Shamir 비밀 분산 (UI: "백업 코드") — 니모닉 대체이자 암호와
                            # 동등한 자격의 유일한 대안. 코드는 시드가 아니라 무작위 AES
                            # 래핑 키를 쪼개고, 그 키로 시드를 wrap한 결과(ShamirWrappedSeed)를
                            # 저장한다 — 그래야 재발급이 옛 코드를 실제로 무효화한다. 복원
                            # 성공 여부는 AES-GCM 인증 태그로 판별(passphrase.ts의
                            # WrongPassphraseError와 동일한 패턴)
    hybridKem.ts             # encapsulateContentKey / decapsulateContentKey (X25519+ML-KEM-768)
    entry.ts                  # encryptEntry / decryptEntry (일기 항목 단위)
    codec.ts                   # 위 타입들의 base64 Firestore 저장 변환 (암호화 로직 없음)
    __tests__/                  # Vitest 단위 테스트

  firebase/          # Firebase Auth(이메일/비밀번호 + Google) / Firestore 클라이언트 연동.
                      # 평문·키를 다루지 않고, lib/crypto의 공개 API만 호출한다.
    config.ts, auth.ts, users.ts, entries.ts
    otp.ts             # functions/의 OTP callable 래퍼. 여기도 크립토 없음 — 접근 게이트일 뿐.
    appCheck.ts          # App Check(reCAPTCHA v3) 초기화 — "DDoS 방지" 참조. 크립토 없음.

  passphraseStrength.ts   # zxcvbn-ts 강도 추정 (lib/crypto 밖 — 암호화 연산이 아닌 UX 휴리스틱)

hooks/
  usePageTitle.ts              # 탭 제목
  usePrivateWritingMode.ts     # /write 블러 표시 여부 (localStorage, 계정에는 저장 안 함)

contexts/
  AuthContext.tsx    # Firebase 로그인 상태만 추적
  OtpContext.tsx      # OTP 활성화 여부/이번 세션 인증 여부를 ID 토큰 커스텀 클레임에서 추적.
                       # AuthContext와 SeedContext 사이에 위치 (로그인 이후, 시드 상태 이전 게이트)
  SeedContext.tsx     # 시드 상태(미발급/잠김/해제됨) + 백업 코드 설정 여부를 추적.
                       # unlock/lock/changePassphrase/resetKeys 외에, 백업 코드 설정/재발급을
                       # 위한 stage/prepare/confirm 3단계 API와 resetPassphraseWithShamirShares
                       # 보유 (암호·백업 코드 어느 쪽으로도 서로를 관리 가능 — 아래 참조)

components/
  SecretReveal.tsx              # "한 번만 보여주고 다시 못 봄" 공용 스캐폴드 (백업 코드에 재사용)
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

원래 설계(ARCHITECTURE.md §3.1)의 BIP39 24단어 니모닉은 제거했다. 이후 독립적으로 켜고 끄는 복수의 "복구 방법"(복구 키 + Shamir, OR로 결합) 모델을 거쳐, 지금은 **암호와 백업 코드(Shamir 비밀 분산) 두 가지만 남기고, 이 둘을 완전히 동등한 자격("상호보안적")으로** 만들었다. (UI 용어: 코드상 "passphrase"는 화면에 "암호"로, "Shamir shares"는 "백업 코드"로 표시된다 — 아래 설명은 UI 용어를 따른다.)

- **암호 (항상 켜져 있음)** — 평소에 쓰는 기본 방법. 끌 수 없다.
- **백업 코드 (opt-in)** — `shamir-secret-sharing`(Cure53·Zellic 감사 완료, WASM 없음)으로 N개 코드를 만들고 K개 이상 모아야 복원. **코드가 직접 시드를 쪼개진 않는다** — 무작위로 생성한 AES-256 래핑 키를 쪼개고, 그 키로 시드를 AES-GCM wrap한 결과(`decryptionMethods.shamir.wrappedSeed`)를 Firestore에 저장한다(암호가 `wrappedSeed`를 wrap하는 것과 같은 구조). `(n, k)`와 이 wrap 결과만 저장되고, 코드 자체·래핑 키는 서버에 전혀 남지 않는다.

둘 중 **어느 쪽을 알고 있어도** 다음 세 가지를 모두 할 수 있다:

1. 일기를 복호화한다 (`unlock` / `unlockWithShamirShares`).
2. 암호를 재설정한다 (`changePassphrase`는 기존 암호로, `resetPassphraseWithShamirShares`는 K개의 백업 코드로 — 어느 쪽이든 시드 자체는 그대로이므로 기존 일기와 이미 발급된 백업 코드가 계속 유효하다).
3. 백업 코드를 새로 만들거나 재발급한다 (`prepareShamir`/`confirmPendingShamir` — 어느 쪽으로 증명했든 같은 동작).

단, **어느 한쪽을 안다고 해서 다른 쪽의 실제 값을 알아낼 수는 없다** — 구조적으로 보장된다. 백업 코드를 복원해도 얻는 건 시드뿐, 암호 문자열은 애초에 시드로부터 유도되지 않으므로 알아낼 수 없다. 암호로 시드를 풀어도 이미 발급된 백업 코드의 실제 값은 알 수 없다.

**재발급은 실제로 이전 것을 무효화한다(단순히 "새 코드를 추가로 내주는" 게 아니다).** 위의 래핑 키 wrap 구조 덕분에, 백업 코드를 재발급하면 새 래핑 키로 시드를 다시 wrap해 Firestore의 `wrappedSeed` 값을 완전히 교체한다 — 이전 코드들은 (수학적으로는 여전히 유효한 옛 래핑 키를 복원하지만) 그 키로 열 수 있는 암호문이 더 이상 존재하지 않으므로 무력화된다. 시드를 직접 쪼개기만 했다면 재발급이 옛 코드를 결코 무효화하지 못했을 것이다(수학적으로 같은 비밀을 계속 복원하므로) — 이게 바로 애초에 이 래핑 키 계층을 둔 이유다. 암호 재설정도 같은 원리로 이미 안전하다(`wrapSeed`가 매번 새 salt로 wrap하므로 옛 암호는 교체된 `wrappedSeed`를 열 수 없다). 두 경로 모두 시드 자체와 `entries`(append-only)는 전혀 건드리지 않으므로, 자격 증명을 교체해도 모든 일기가 그대로 읽힌다.

평소에는 암호만 쓰고, 그것을 잊어버렸을 때 비로소 백업 코드가 비상 수단으로 쓰인다. 백업 코드로 복구한 뒤에는 새 암호를 설정하길 권장한다(강제는 아님). 반대로 백업 코드를 잃어버렸다면 암호로 새 코드를 재발급하면 된다. 재구성이 진짜인지는 별도 검증 데이터 없이 AES-GCM의 인증 태그 자체로 판별한다(`combineSeedShamir`가 wrap된 시드를 복호화하는 데 실패하면 `InvalidShamirSharesError`) — 암호 경로가 `unwrapSeed`의 AES-GCM 인증 실패를 그대로 신호로 쓰는 것과 동일한 패턴이다.

암호와 백업 코드를 **둘 다** 잃어버린 경우에만 `/settings`의 "초기화"(브랜드 뉴 시드 발급, 기존 일기 전부 영구 손실)가 남는다.

> **마이그레이션 주의**: 이 래핑 키 indirection 이전에 백업 코드를 설정해둔 계정은 Firestore에 `wrappedSeed` 없이 `{n, k}`만 있는 옛 형태로 저장되어 있다. 그런 계정은 백업 코드로 잠금 해제/재설정을 시도하기 전에 **한 번 재발급**해야 한다(암호로 증명 후 `/settings`에서 재발급).

## OTP 인증 (접근 게이트, 암호화 요인 아님)

`/settings`에서 OTP(구글 OTP 등 인증 앱)를 켜면, `entries` 컬렉션을 읽을 때(=일기를 볼 때) 서버가 검증한 OTP 코드가 최근 12시간 내에 있어야 한다. **이건 시드를 감싸는 암호학적 키 조합이 아니다** — 6자리 회전 코드는 엔트로피가 너무 낮아 키 재료로 쓸 수 없고, 원본 TOTP 시크릿을 매번 다시 입력하게 하면 OTP 특유의 사용성이 사라진다. 대신 Bitwarden 등 다른 제로 지식 서비스들이 쓰는 것과 같은 패턴을 썼다: **금고 자체(시드 암호화)는 여전히 완전한 제로 지식이고, OTP는 그 위에 얹힌 서버 검증 접근 게이트**다.

- TOTP 시크릿은 `functions/`(Cloud Functions, Admin SDK)만 만들고 저장한다 — `otpSecrets/{uid}`는 `firestore.rules`에서 클라이언트에 완전히 차단.
- 코드가 맞으면 Cloud Function이 Firebase Auth ID 토큰에 `otpEnabled` / `otpVerified` / `otpVerifiedAt` 커스텀 클레임을 심고, `firestore.rules`의 `otpSatisfied()`가 `entries` 읽기에서 이를 요구한다.
- `users/{uid}` 읽기는 OTP로 게이트하지 **않는다** — `publicKeys`가 있어야 쓰기가 되는데, 쓰기는 잠금 여부와 무관하게 항상 가능해야 하기 때문(ARCHITECTURE.md §3.2 규칙 5).
- **활성화는 먼저 암호를 증명해야 시작된다** (`/settings`에서 "OTP 활성화" → 암호 입력 → 통과해야 QR 스캔 단계로 진행) — 백업 코드 설정/해제와 같은 "계정 보안 설정을 바꾸기 전에 마스터 자격 증명 하나를 증명" 규칙. 그 뒤 QR 스캔 + 코드 1회 확인. 비활성화는 현재 유효한 OTP 코드가 있어야 함.
- 6자리 코드의 낮은 엔트로피 때문에 Cloud Function에 실패 5회당 60초 잠금을 넣었다 — 없으면 유효한 로그인 세션을 가진 공격자가 무차별 대입할 수 있다.
- **백업 코드로 일기를 복구할 때는 OTP를 요구하지 않는다.** OTP가 켜져 있으면 보통 `entries` 읽기 자체가 서버에서 막혀 있어 암호든 백업 코드든 시도해보기도 전에 OTP를 먼저 통과해야 하는데, 이러면 OTP 기기를 잃어버리는 것만으로 "잃어도 무조건 살아있어야 할" 백업 코드 복구 경로까지 함께 막혀버린다. 그래서 백업 코드는 `verifyShamirOtpBypass`라는 별도 Cloud Function으로 같은 `otpVerified`/`otpVerifiedAt` 클레임을 얻는다 — TOTP 코드 대신, 클라이언트가 로컬에서 코드를 조합해 얻은 래핑 키로부터 계산한 일방향 증명값(`computeShamirOtpBypassProof`, HKDF-SHA256)을 서버에 저장된 값과 대조한다. 이 증명값은 오직 실제 K개의 백업 코드를 조합해야 나오는 값이라, 암호만 알아서는 절대 만들어낼 수 없다(래핑 키는 암호 경로가 전혀 건드리지 않는 독립된 난수이기 때문) — 그래서 OTP 우회가 암호 탈취범에게는 아무 도움이 되지 않으면서, 백업 코드 보유자에게는 확실히 열려 있다.

## 프라이빗 작성 모드

`/settings`의 "프라이빗 작성 모드" 토글을 켜면 `/write`에서 타이핑하는 동안 텍스트 영역이 흐리게(`blur`) 표시되어, 화면을 옆에서 보더라도 내용을 읽을 수 없다 — 다만 그 자체가 "흐릿한 글자가 채워지고 있다"는 시각적 피드백이라 밋밋하게 가려지는 느낌은 아니다. 작성자 본인은 "잠깐 보기" 버튼으로 즉시 켜고 끌 수 있다.

- `hooks/usePrivateWritingMode.ts`가 유일한 상태 보관 지점 — `localStorage` 기반이며 계정(Firestore)에는 전혀 저장되지 않는다. "지금 옆에 누가 있는가"는 계정이 아니라 기기/순간의 속성이라는 판단이고, 암호화와 무관한 순수 UI 설정에 Firestore 스키마/규칙 변경을 들일 이유가 없기 때문이다.
- `/write`의 실제 `<textarea>` 값·`writeEntry` 호출 경로는 전혀 바뀌지 않는다 — CSS `filter: blur()`만 씌우는 순수 표시 계층이라, 암호화되어 나가는 내용과는 무관하다.
- 알아둘 한계: CSS 블러는 DOM 안의 실제 글자를 가리는 게 아니라 시각적으로만 흐리게 만든다. 브라우저 개발자 도구로 DOM을 열어보거나 화면 낭독기를 쓰면 원문이 그대로 노출된다 — "곁눈질 방지" 용도이지 암호학적 보호가 아니다.

## DDoS 방지

두 겹으로 대응한다 — 네트워크 볼륨 공격 자체는 Firestore/Cloud Functions가 Google 인프라(Cloud Run + Google Front End) 위에서 이미 흡수하므로, 앱 코드가 실제로 손댈 수 있는 지점은 "공개된 Firebase 설정값을 그대로 긁어다 스크립트로 두드리는" 종류의 남용이다.

1. **Firebase App Check (reCAPTCHA v3)** — `lib/firebase/appCheck.ts` / `lib/firebase/config.ts`에서 초기화. reCAPTCHA v3는 챌린지 없이 백그라운드에서 점수만 매기므로 실사용자는 아무것도 느끼지 않는다("사용자 경험을 해치지 않는" DDoS 방지의 핵심). 다만 **아래 두 단계는 코드로 할 수 없는, 사람이 콘솔에서 직접 해야 하는 작업이다**:
   - Firebase 콘솔 > App Check > 앱 등록에서 이 웹 앱에 대한 reCAPTCHA v3 사이트 키를 발급받아 `NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY`로 설정(Vercel 환경변수 포함).
   - Firebase 콘솔 > App Check > API 탭에서 Cloud Firestore의 "Enforce"를 켠다. (Cloud Functions 쪽은 코드 레벨 `enforceAppCheck` 옵션으로 이미 제어된다 — 아래 2번.)
   - 로컬 개발(`next dev`)은 사이트 키 없이도 App Check 디버그 토큰을 자동으로 써서 그대로 동작한다.
2. **Cloud Functions `enforceAppCheck`** — `functions/src/index.ts`의 모든 callable에 `enforceAppCheck: APP_CHECK_ENFORCE`를 걸어뒀다. 기본값은 `false`(`functions/.env.example`) — 클라이언트가 실제 유효한 App Check 토큰을 발급받기 전에 이 코드만 배포되어도 전체 OTP 기능이 즉시 막히는 걸 막기 위한 안전장치다. 위 1번(사이트 키 + 클라이언트 배포)이 끝난 뒤 `functions/.env`에 `APP_CHECK_ENFORCE=true`를 넣고 `firebase deploy --only functions`.
3. **Firestore 규칙의 항목 크기 상한** — `firestore.rules`의 `isValidEntrySize()`가 `entries` 쓰기의 `ciphertext`를 500,000자로 제한한다. 남용 트래픽의 속도(rate)가 아니라 한 건당 크기(size)만 막는 저비용 방어선 — 실제 남용 트래픽 차단은 위 App Check가 담당한다.
4. CSP(`proxy.ts`)에 reCAPTCHA v3/App Check가 쓰는 `www.google.com` / `www.gstatic.com` / `firebaseappcheck.googleapis.com`을 이미 허용해뒀다 — 사이트 키를 설정하기 전까지는 아무 요청도 나가지 않으므로 지금 당장의 동작에는 영향이 없다.

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
2. Vercel 프로젝트 설정 > Environment Variables에 `.env.example`의 6개 `NEXT_PUBLIC_FIREBASE_*` 값을 등록 (Production/Preview/Development 모두). `NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY`는 App Check를 쓸 때만 필요("DDoS 방지" 참조) — 비워두면 지금처럼 App Check 없이 동작한다.
3. **Firebase 콘솔 > Authentication > Settings > Authorized domains에 Vercel 배포 도메인을 추가해야 로그인이 동작한다** (`*.vercel.app` 프리뷰 도메인 포함, 커스텀 도메인 사용 시 그것도 추가).
4. Next.js 앱(Vercel에 배포되는 쪽) 자체는 여전히 전부 클라이언트 사이드 Firebase SDK 호출만 하므로 Vercel 쪽에는 시크릿 환경변수가 전혀 없다. 서버 로직(OTP 검증)은 Vercel이 아니라 Firebase Cloud Functions에서 별도로 돌아간다 — 위 "Firestore 규칙 / Cloud Functions 배포" 참조.

## 보안 헤더 / CSP

`next.config.ts`에 정적 헤더(HSTS, X-Frame-Options 등), `proxy.ts`에 요청마다 새로 발급하는 CSP nonce가 있다. Next.js App Router의 하이드레이션 스크립트에 nonce를 붙이려면 페이지가 요청마다 렌더링되어야 하므로 `app/layout.tsx`에 `export const dynamic = "force-dynamic"`을 설정했다 (이 앱은 서버 데이터 의존성이 없는 클라이언트 앱이라 정적 생성의 이점이 크지 않고, 개인용 규모에서 요청마다 렌더링하는 비용은 무시할 만하다).
