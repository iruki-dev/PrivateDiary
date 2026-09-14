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

  passphraseStrength.ts   # zxcvbn-ts 강도 추정 (lib/crypto 밖 — 암호화 연산이 아닌 UX 휴리스틱)

  security/          # 브라우저/로컬 환경 자체가 변조되었을 가능성을 감지하는 모듈.
                      # lib/crypto와 달리 암호 연산을 하지 않고, window/navigator를 읽는다
                      # ("클라이언트 환경 변조 감지" 참조).
    nativeIntegrity.ts  # crypto.subtle 등 보안 관련 전역 API가 확장 프로그램/주입 스크립트에
                        # 의해 후킹되었는지 감지 — 감지되면 SeedContext/entries.ts가 잠금 해제·
                        # 저장·복호화를 실제로 차단한다.
    environmentSignals.ts # 안전하지 않은 컨텍스트/자동화 도구/개발자 도구 열림 — 차단은 안 하고
                          # 배너로 경고만 하는 약한 신호들
    clipboard.ts        # 복사한 백업 코드를 일정 시간 후 자동으로 지움

hooks/
  usePageTitle.ts              # 탭 제목

contexts/
  AuthContext.tsx    # Firebase 로그인 상태만 추적
  PreferencesContext.tsx  # 계정 단위 표시 설정(프라이빗 작성 모드 등) — users/{uid}.preferences.
                           # AuthContext 바로 아래 위치 — 시드/OTP 상태와 무관
  OtpContext.tsx      # OTP 활성화 여부/이번 세션 인증 여부를 ID 토큰 커스텀 클레임에서 추적.
                       # AuthContext와 SeedContext 사이에 위치 (로그인 이후, 시드 상태 이전 게이트)
  SeedContext.tsx     # 시드 상태(미발급/잠김/해제됨) + 백업 코드 설정 여부를 추적.
                       # unlock/lock/changePassphrase/resetKeys 외에, 백업 코드 설정/재발급을
                       # 위한 stage/prepare/confirm 3단계 API와 resetPassphraseWithShamirShares
                       # 보유 (암호·백업 코드 어느 쪽으로도 서로를 관리 가능 — 아래 참조)
  SecurityContext.tsx # lib/security의 검사를 주기적으로 돌리고 배너(SecurityWarningBanner)에
                       # 상태를 제공. Provider 트리 맨 바깥 — 로그인 여부와 무관하게 항상 감시

components/
  SecretReveal.tsx              # "한 번만 보여주고 다시 못 봄" 공용 스캐폴드 (백업 코드에 재사용)
  SecretCard.tsx                 # 복호화 비밀 하나를 QR + 텍스트 + 다운로드로 표시
  OtpGate.tsx                     # OTP 활성화 시 코드 입력 전까지 children을 가리는 래퍼 (/entries에서 사용)
  OtpQrCard.tsx                    # OTP 설정용 QR(otpauth:// URI) + 수동 입력 코드 표시
  PassphraseStrengthMeter.tsx
  SecurityWarningBanner.tsx         # 모든 페이지 상단에 렌더 — 변조 감지 시 차단 안내(닫기 불가),
                                    # 그 외 약한 신호는 개별적으로 닫을 수 있는 경고

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

`/settings`의 "프라이빗 작성 모드"를 켜면 `/write`에서 타이핑하는 동안 텍스트 영역이 옅게 흐려져(`blur(4px)`), 화면을 옆에서 보더라도 내용을 읽을 수 없다. 배너나 박스 없이 텍스트 영역 우측 상단의 아이콘 하나뿐이고, 이 앱의 기존 무채색 디자인을 그대로 따른다.

- 작성자 본인의 확인은 그 아이콘을 **누르고 있는 동안만** 잠깐 보여주는 방식(hold-to-reveal, 토글 아님)이다. 마우스/터치(pointer 이벤트)와 키보드(스페이스/엔터) 모두 지원한다.
- `/settings`에 두 번째 토글("확인 아이콘")이 있다 — 이걸 끄면 `/write`가 그 아이콘을 렌더링하지 않으므로, 프라이빗 모드가 켜진 동안은 **작성자 본인도** 어떤 방법으로도 흐림을 해제할 수 없다.
- 두 설정 모두 `users/{uid}.preferences`(Firestore, `contexts/PreferencesContext.tsx`)에 저장되어 계정에 로그인한 모든 기기에 동일하게 적용된다 — 기기별로 다르게 켜둘 수 없다. lib/crypto가 다루는 어떤 것도 이 필드를 참조하지 않으므로(`firestore.rules`의 `isValidPreferences()`는 형태만 검증), Firestore에 저장한다고 해서 §1.1의 "서버는 평문/키를 절대 보지 않는다" 원칙이 흔들리지 않는다 — 여긴 애초에 지킬 비밀이 없다.
- `/write`의 실제 `<textarea>` 값·`writeEntry` 호출 경로는 전혀 바뀌지 않는다 — CSS `filter: blur()`만 씌우는 순수 표시 계층이라, 암호화되어 나가는 내용과는 무관하다.
- 알아둘 한계: CSS 블러는 DOM 안의 실제 글자를 가리는 게 아니라 시각적으로만 흐리게 만든다. 브라우저 개발자 도구로 DOM을 열어보거나 화면 낭독기를 쓰면 원문이 그대로 노출된다 — "곁눈질 방지" 용도이지 암호학적 보호가 아니다.

## DDoS 방지

네트워크 볼륨 공격 자체는 Firestore/Cloud Functions가 Google 인프라(Cloud Run + Google Front End) 위에서 이미 흡수하므로, 앱 코드가 실제로 손댈 수 있는 지점은 "공개된 Firebase 설정값을 그대로 긁어다 스크립트로 두드리는" 종류의 남용이다.

**Firebase App Check(reCAPTCHA)는 도입했다가 완전히 제거했다.** classic reCAPTCHA v3는 App Check 콘솔에서 신규 등록 자체가 막혀 있어 reCAPTCHA Enterprise로 전환했고, 사이트 키·Enterprise API 활성화·App Check 등록까지 전부 정확히 맞췄지만, **Firestore 웹 SDK가 발급된 App Check 토큰을 요청에 아예 붙이지 않는 현상**을 프로덕션에서 직접 확인했다(네트워크 탭에 `X-Firebase-AppCheck` 헤더 자체가 없음) — [firebase/flutterfire#18672](https://github.com/firebase/flutterfire/issues/18672)에 동일 증상이 보고된, 이 글 작성 시점 기준 미해결 Firebase JS SDK 버그로 보인다. Cloud Functions 쪽(별개의 직접 HTTPS 경로라 이 버그의 영향을 안 받음)은 정상 동작했지만, Firestore 없이는 봇 방지 효과가 절반뿐이고 Enterprise 설정 자체의 운영 부담(결제 계정 연결, API 활성화, 사이트 키/등록 관리)도 있어 — 남는 코드/설정을 전부 걷어내고 아래 방어선만 남기기로 했다.

1. **Firestore 규칙의 항목 크기 상한** — `firestore.rules`의 `isValidEntry()`가 `entries` 쓰기의 `ciphertext`를 500,000자로 제한한다. 남용 트래픽의 속도(rate)가 아니라 한 건당 크기(size)만 막는 저비용 방어선.
2. **OTP 브루트포스 잠금** — `functions/src/index.ts`의 `verifyStoredOtp`가 5회 실패 시 60초 잠금을 건다(Firestore 트랜잭션으로 원자적 — 동시 요청도 우회 못 함).
3. Firebase Authentication/Firestore 자체의 요청 한도(quota)가 기본 방어선으로 남아있다 — App Check가 있었다면 그 앞단에서 더 저렴하게 걸러졌을 종류의 남용이 지금은 Firebase 자체 한도까지 도달한다는 뜻이지만, 이 앱 규모(개인용)에서는 감수할 만한 트레이드오프로 판단했다.

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

## 클라이언트 환경 변조 감지 (security-patch-v3)

CSP·Firestore 규칙·Cloud Functions는 전부 "이 페이지가 보낸 코드가 실제로 이 앱이 배포한 코드"라는 전제 위에 서 있다. 악성 브라우저 확장 프로그램(특히 Chrome MV3의 `world: "MAIN"`처럼 페이지 자신의 실행 컨텍스트에 직접 주입되는 콘텐츠 스크립트)이나 이미 감염된 로컬 환경은 이 페이지의 CSP를 전혀 거치지 않는다 — 브라우저가 사용자 권한으로 직접 실행해주는 코드이지, 이 페이지가 로드한 "콘텐츠"가 아니기 때문이다. **이건 코드로 완전히 막을 수 있는 문제가 아니다.** `lib/security/`는 이 전제를 정면으로 인정하고, "완전 차단"이 아니라 "최선을 다한 감지 + 가능하면 차단, 안 되면 경고"를 목표로 한다.

- **`lib/security/nativeIntegrity.ts`** — `crypto.subtle.encrypt/decrypt`, `Uint8Array`, `TextEncoder`, `JSON.stringify` 등 이 앱의 암호화가 실제로 의존하는 전역 API들이 후킹(몽키패치)되었는지 두 가지 신호로 감지한다: (1) 이 모듈이 로드된 시점에 캡처해둔 참조와 지금 값이 다른지, (2) `Function.prototype.toString`(이것도 앱 로드 시점에 미리 캡처해둠 — 그래야 이것 자체가 조작당해도 속지 않는다)으로 확인했을 때 브라우저 네이티브 코드 모양(`[native code]`)이 아닌지. 감지되면 `contexts/SeedContext.tsx`의 잠금 해제/암호 변경/백업 코드 설정/초기화, `lib/firebase/entries.ts`의 저장, `app/entries/page.tsx`의 복호화가 **실제로 차단**된다 — 이 프로젝트에서 "코드로 막을 수 있는 부분"에 해당하는 유일한 지점이다.
  - **한계를 숨기지 않는다**: 확장 프로그램의 콘텐츠 스크립트가 이 앱의 JS보다 먼저 실행되면(예: `document_start`), 그 스크립트는 이 모듈이 기준값을 캡처하기도 전에 API를 이미 바꿔치기했을 수 있고, 그 경우 이 검사는 "원래부터 이런 모양이었나 보다" 하고 속을 수 있다 — 이건 브라우저 확장 프로그램 권한 모델 자체의 한계이지, 이 코드가 서툴러서가 아니다. 그래서 이 검사는 앱 시작 시 1회뿐 아니라 민감한 작업 직전마다, 그리고 백그라운드에서 주기적으로/탭 포커스 복귀 시에도 다시 돈다 — 늦게 주입되거나 세션 도중에 걸리는 변조까지 넓게 잡기 위해서다.
- **`lib/security/environmentSignals.ts`** — 차단할 정도는 아니지만 알려줄 가치가 있는 신호들: 안전하지 않은 컨텍스트(HTTP), `navigator.webdriver`(자동화/원격 제어 도구), 개발자 도구가 열려 있음(콘솔 오브젝트 프리뷰 getter 트릭 — 완벽하지 않은 휴리스틱임을 명시). 각각 정상적인 이유로도 참일 수 있어(개발자 본인, 접근성 도구 등) 닫을 수 있는 경고로만 표시한다.
- **`lib/security/clipboard.ts`** — 백업 코드를 클립보드에 복사하면 30초 후 자동으로 지운다(단, 그 사이 사용자가 클립보드에 다른 걸 복사하지 않았을 때만 — `readText()`로 먼저 확인). 클립보드는 `clipboardRead` 권한을 가진 확장 프로그램이나 같은 기기의 다른 프로그램이 읽을 수 있는 채널이라, 페이지 코드가 "그 사이"에 끼어들어 막을 방법은 없다 — 노출 시간을 줄이는 것이 최선이다(1Password/Bitwarden 등이 쓰는 것과 같은 완화책).
- **`components/SecurityWarningBanner.tsx`** — 위 신호들을 모든 페이지 상단에 표시. 변조 감지는 닫기 버튼이 없다(실제로 차단되고 있는 상태이므로 숨겨봐야 의미가 없다); 나머지는 개별적으로 닫을 수 있다.

이 기능 전체가 "완전한 차단"이 아니라 "탐지 가능한 범위를 최대한 넓히는 심층 방어"라는 점은 각 모듈 자체의 doc comment에도 반복해서 적어뒀다 — 과장해서 안전하다고 주장하는 것이 실제로 더 위험하기 때문이다.
