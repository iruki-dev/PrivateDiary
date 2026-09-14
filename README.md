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

위 명령은 그대로 `.github/workflows/ci.yml`에서도 돌아간다 — push/PR마다 lint · 단위 테스트 ·
빌드 · 타입체크, Firestore 보안 규칙 테스트(에뮬레이터 + JDK), `functions/` 컴파일이 각각
별도 job으로 실행된다.

> `pnpm exec tsc --noEmit`은 `pnpm build`를 한 번 돌린 뒤에 실행해야 한다. `app/layout.tsx`가
> 쓰는 `LayoutProps<"/">`는 Next.js가 빌드 중 `.next/types/`에 생성하는 전역 헬퍼라, 갓
> 체크아웃한 트리에서는 아직 존재하지 않는다.

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
    otp.ts             # functions/의 OTP callable 래퍼(계정 삭제 포함). 여기도 크립토 없음 — 접근 게이트일 뿐.

  entries/           # 복호화가 끝난 뒤의 읽기 UX 로직. 크립토·Firebase·React를 일절
                      # import하지 않는 순수 함수 모듈이라 단위 테스트로 검증된다.
    search.ts          # 클라이언트 검색(NFC 정규화, AND 결합, 하이라이트 범위, 스니펫) + 월별 그룹핑
    calendar.ts         # 달력 그리드 · 일자별 개수 · 연속 기록 · "이날의 기록" — createdAt만 사용
    export.ts            # 복호화된 일기를 Markdown/JSON 아카이브로 직렬화

  preferences.ts          # 계정 설정(users/{uid}.preferences)의 형태·기본값·검증.
                           # Firebase를 import하지 않아 firestore.rules와 1:1로 대조·테스트된다.
  passphraseStrength.ts    # zxcvbn-ts 강도 추정 (lib/crypto 밖 — 암호화 연산이 아닌 UX 휴리스틱)
  drafts.ts                 # 작성 중인 일기의 기기 로컬 임시 저장 — 이 앱에서 유일하게 평문을 디스크에 쓰는 곳 (기본값 꺼짐)

hooks/
  usePageTitle.ts              # 탭 제목
  useDecryptedEntries.ts        # 일기 목록을 청크 단위로 점진 복호화 (아래 "지난 일기" 참조)

contexts/
  AuthContext.tsx    # Firebase 로그인 상태만 추적
  PreferencesContext.tsx  # 계정 단위 설정 — users/{uid}.preferences (프라이빗 작성 모드, 자동 잠금
                           # 시간, 임시 저장 여부). AuthContext 바로 아래이자 SeedContext 위에
                           # 위치해야 한다 — SeedContext가 여기서 자동 잠금 시간을 읽는다
  OtpContext.tsx      # OTP 활성화 여부/이번 세션 인증 여부를 ID 토큰 커스텀 클레임에서 추적.
                       # AuthContext와 SeedContext 사이에 위치 (로그인 이후, 시드 상태 이전 게이트)
  SeedContext.tsx     # 시드 상태(미발급/잠김/해제됨) + 백업 코드 설정 여부를 추적.
                       # unlock/lock/changePassphrase/resetKeys 외에, 백업 코드 설정/재발급을
                       # 위한 stage/prepare/confirm 3단계 API와 resetPassphraseWithShamirShares
                       # 보유 (암호·백업 코드 어느 쪽으로도 서로를 관리 가능 — 아래 참조).
                       # 계정 설정의 자동 잠금 시간에 따라 유휴 시 스스로 lock()도 호출한다
                       # ("자동 잠금" 참조)

components/
  SecretReveal.tsx              # "한 번만 보여주고 다시 못 봄" 공용 스캐폴드 (백업 코드에 재사용)
  SecretCard.tsx                 # 복호화 비밀 하나를 QR + 텍스트 + 다운로드로 표시
  OtpGate.tsx                     # OTP 활성화 시 코드 입력 전까지 children을 가리는 래퍼 (/entries에서 사용)
  OtpQrCard.tsx                    # OTP 설정용 QR(otpauth:// URI) + 수동 입력 코드 표시
  PassphraseStrengthMeter.tsx
  EntryBrowser.tsx                   # 잠금 해제 후의 읽기 화면 전체 (달력 · 검색 · 필터 · 정렬 · 통계 · 내보내기)
  EntryCalendar.tsx                   # 월 달력 — 일기가 있는 날만 클릭 가능, 모바일에서는 접힌다
  EntryStats.tsx                       # 전체/이번 달/기록한 날/연속 기록
  EntryCard.tsx                         # 일기 한 건 — 긴 글은 접고, 검색 중에는 일치 지점 주변만 보여준다
  HighlightedText.tsx                    # 검색어 일치 구간을 <mark>로 표시
  ExportEntriesCard.tsx                   # 복호화된 일기를 파일로 내려받기 (평문 경고 포함)

app/                  # Next.js App Router 페이지
  login/, signup/, settings/, write/, entries/
  manifest.ts          # 웹 앱 매니페스트 (홈 화면 설치 — "설치형 앱(PWA)" 참조)
  icon.svg, apple-icon.png, favicon.ico   # 앱 아이콘

.github/workflows/ci.yml   # lint · 단위 테스트 · 빌드 · 타입체크 / Firestore 규칙 테스트 / functions 컴파일

functions/             # Firebase Cloud Functions — 이 프로젝트에서 유일한 서버 로직.
                        # OTP 코드 검증과 계정 삭제만 담당하고 시드·개인키·평문은 절대 다루지 않는다.
                        # startOtpSetup / confirmOtpSetup / verifyOtp / verifyShamirOtpBypass /
                        # disableOtp / deleteAccount
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
- 두 설정 모두 `users/{uid}.preferences`(Firestore, `contexts/PreferencesContext.tsx`, 형태·기본값·검증은 `lib/preferences.ts`)에 저장되어 계정에 로그인한 모든 기기에 동일하게 적용된다. lib/crypto가 다루는 어떤 것도 이 필드를 참조하지 않으므로, Firestore에 저장한다고 해서 §1.1의 "서버는 평문/키를 절대 보지 않는다" 원칙이 흔들리지 않는다.
- **다만 `preferences` 전체가 이제 OTP 게이트 뒤에 있다** — 같은 필드에 자동 잠금 시간이 함께 들어왔기 때문이다("자동 잠금" 참조). 그래서 `/settings`의 이 토글도 OTP를 통과해야 바꿀 수 있다.
- `/write`의 실제 `<textarea>` 값·`writeEntry` 호출 경로는 전혀 바뀌지 않는다 — CSS `filter: blur()`만 씌우는 순수 표시 계층이라, 암호화되어 나가는 내용과는 무관하다.
- 알아둘 한계: CSS 블러는 DOM 안의 실제 글자를 가리는 게 아니라 시각적으로만 흐리게 만든다. 브라우저 개발자 도구로 DOM을 열어보거나 화면 낭독기를 쓰면 원문이 그대로 노출된다 — "곁눈질 방지" 용도이지 암호학적 보호가 아니다.

## 지난 일기 읽기 (달력 · 검색 · 통계)

`/entries`의 잠금 해제 이후 화면은 `components/EntryBrowser.tsx`가 담당한다. 서버는 암호문만 갖고 있으므로 **검색·정렬·필터를 서버가 대신 해줄 방법이 구조적으로 없다**(ARCHITECTURE.md §9). 전부 이 탭의 메모리 안에서, 잠금이 풀려 있는 동안만 이루어진다.

**달력과 통계** (`lib/entries/calendar.ts`, `components/EntryCalendar.tsx`)
- 넓은 화면에서는 왼쪽에 달력과 통계가 고정(sticky)되고 오른쪽에서 목록이 스크롤된다. 좁은 화면에서는 달력이 "달력" 버튼 뒤로 접힌다 — 휴대폰에서 월 그리드가 항상 펼쳐져 있으면 정작 일기가 화면 밖으로 밀려난다.
- 일기가 있는 날만 누를 수 있고, 누르면 그 날짜로 목록이 걸러진다. 일기가 없는 날은 버튼이 아니라 그냥 글자라, 키보드로 탭 이동할 때 아무 데도 가지 않는 칸 서른 개를 지나칠 필요가 없다.
- 통계는 전체/이번 달/기록한 날/연속 기록/최장 연속. **연속 기록은 오늘 아직 안 썼으면 어제부터 센다** — 그러지 않으면 한 달째 이어온 기록이 매일 아침 0으로 보이고, 그 숫자가 힘이 되어야 할 바로 그 순간에 꺼져버린다.
- **"이날의 기록"** — 작년·재작년 같은 날짜에 쓴 일기가 있으면 그것만 모아 보여준다. 몇 년씩 쓰는 일기장의 본전이 나오는 지점이다.

> **보안상 중요한 점**: 달력·통계·연속 기록은 **전부 `createdAt`만으로** 계산된다. 그 타임스탬프는 이미 Firestore에 평문으로 저장되어 있고 목록 화면이 늘 표시해오던 값이라, 시각화한다고 해서 DB를 볼 수 있는 쪽이 새로 알게 되는 건 없다 — 서버는 *언제* 썼는지는 알고 *무엇을* 썼는지는 끝까지 모른다(이 메타데이터 유출 자체는 ARCHITECTURE.md §9에 기재된 기존 성질이다). 부수 효과로 달력과 통계는 **복호화가 한 건도 끝나기 전부터 정확하다.**

**검색·필터·정렬**
- **점진 복호화** (`hooks/useDecryptedEntries.ts`) — 읽기 경로는 항목 하나당 X25519 ECDH + ML-KEM-768 decapsulation + HKDF + AES-GCM 2회를 메인 스레드에서 동기로 돌린다. 전부 복호화한 뒤에 렌더링하면 일기가 수백 건만 되어도 화면이 몇 초간 멈추고, 일기가 늘수록 영원히 나빠진다. 최신 6건씩 끊어 복호화하고 청크마다 브라우저에 제어권을 넘기므로, 실제로 보려는 최신 일기가 거의 즉시 뜨고 나머지는 뒤에서 계속 처리된다("복호화 n / N" 표시).
- **검색** (`lib/entries/search.ts`) — 공백으로 나눈 단어를 전부 포함하는 항목만 남긴다(AND). 한글 때문에 NFC 정규화를 거친다: 같은 음절이라도 입력기에 따라 조합형(NFD)/완성형(NFC)으로 들어와 바이트가 다르므로, 정규화하지 않으면 macOS에서 쓴 "한글"이 Windows에서 쓴 "한글"을 못 찾는다. 일치 구간은 `<mark>`로 표시하고, 긴 글은 **일치 지점 주변만** 잘라 보여준다.
- **월별 그룹 · 정렬** — 목록은 "2026년 9월" 머리글로 묶이고 최신순/오래된순을 전환할 수 있다. `serverTimestamp()`가 아직 확정되지 않은 방금 쓴 항목은 "저장 중" 그룹으로 따로 빠진다.
- **키보드**: `/`로 검색창에 바로 포커스, `Esc`로 검색어와 날짜 필터를 한 번에 해제. 입력 중일 때는 `/`를 가로채지 않는다.
- 복호화 실패는 **항목 단위**로 표시된다 — 변조된 암호문 한 건이 있어도 나머지 일기는 정상적으로 열린다(§3.4에서 복호화 실패 자체가 변조 신호).

> **일부러 넣지 않은 것 두 가지.** (1) **필터 상태를 URL에 넣지 않는다** — `?day=2026-09-14` 같은 쿼리스트링은 브라우저 히스토리(와 그걸 동기화하는 모든 것)에 "어느 날짜를 다시 들춰봤는가"의 흔적을 남긴다. 프라이빗 작성 모드가 걱정하는 바로 그 공용 기기 시나리오다. (2) **최근 검색어를 저장하지 않는다** — "장례식"을 기억하는 검색창은 이 앱의 암호화가 막는 어떤 것보다 나쁜 유출이다. 필터는 React 상태로만 존재하고 탭과 함께 사라진다.

## 내보내기

`/entries`의 "내보내기"에서 복호화된 일기 전체를 Markdown(`.md`) 또는 JSON(`.json`)으로 내려받는다. 정렬은 `entrySeq` 기준 오래된 순(아카이브의 읽기 순서이며, 타임스탬프가 아직 확정되지 않은 항목도 올바른 자리에 들어간다).

이 기능이 있어야 하는 이유는 이 앱의 엄격함 그 자체다. §3.6 규칙 5와 §9는 암호와 백업 코드를 모두 잃으면 일기가 영구히 사라진다고 못박고, §1.1 규칙 4는 그게 버그가 아니라 설계 목표라고 한다. **비밀번호 하나를 잊는 것만으로 사용자의 글을 정말로 파괴할 수 있는 설계라면, 스스로 사본을 들고 있을 수단을 반드시 줘야 한다** — 그러지 않으면 "당신만의 데이터"는 조용히 "삐끗하기 전까지만 당신의 데이터"가 된다.

내려받는 파일은 정의상 **평문**이다(이 앱과 키 없이도 살아남는 게 목적이므로). UI에서 이 사실을 먼저 경고하고, 다운로드는 별도의 두 번째 클릭을 요구한다. 아직 복호화가 끝나지 않았으면 버튼이 비활성화되어, 빠진 일기가 있는 아카이브가 만들어지지 않는다.

## 자동 잠금

이전에는 한 번 잠금을 해제하면 탭을 닫을 때까지 파생 개인키가 메모리에 남아 있었다 — 여섯 단어 이상의 암호와 서버 검증 OTP까지 요구하는 설계에서 이상한 구멍이었다. 지금은 일정 시간 조작이 없으면 `contexts/SeedContext.tsx`가 스스로 `lock()`을 호출해 키를 폐기한다(기본 15분, `/settings`에서 1분 / 5분 / 15분 / 30분 / 1시간 / 사용 안 함 중 선택). `/entries`에는 수동 "잠그기" 버튼도 있다.

- **단일 `setTimeout`이 아니라 실제 시각(wall-clock)을 주기적으로 비교한다.** 노트북이 잠들면 타이머가 지연되므로, 타이머 하나만 걸어두면 깨어난 순간 타임아웃이 처음부터 다시 시작되어 버린다. `Date.now()`를 비교하면 깨어나자마자 곧바로 잠긴다. 백그라운드 탭은 인터벌이 강하게 스로틀되므로 `visibilitychange`에서도 같은 검사를 한다. 반대로 탭을 숨길 때는 "사용 중"으로 치지 않는다 — 다른 탭을 보는 건 이 탭을 쓰는 게 아니고, 그렇게 세면 백그라운드에 방치된 탭이 스스로 세션을 무한정 갱신하게 된다.
- 긴 일기를 읽는 중에 잠기지 않도록 키 입력뿐 아니라 스크롤/터치도 "사용 중"으로 센다.
- 잠긴 뒤 `/entries`는 이유를 문장으로 알려준다 — 아무 설명 없이 목록이 암호 입력창으로 바뀌면 버그처럼 보이기 때문이다.
- 잠금은 진행 중이던 `/settings` 흐름의 스테이징된 시드도 함께 폐기한다(예: 백업 코드를 화면에 띄워둔 채 자동 잠금이 걸린 경우). 그 상태에서 확인을 누르면 무슨 일이 일어났는지 설명하는 메시지가 뜨고, Firestore에는 아무것도 쓰이지 않았으므로 처음부터 다시 하면 된다.

**설정은 계정(`users/{uid}.preferences`)에 저장되어 로그인한 모든 기기에 적용된다.** 그리고 그 대가로 **보안 규칙을 함께 조였다**: `firestore.rules`의 `isOtpUngatedChange()`가 면제하던 키에서 `preferences`를 빼서, 이제 모든 설정 변경이 `otpSatisfied()`를 요구한다. 이게 없으면 세션만 탈취한 공격자가 피해자의 자동 잠금을 조용히 꺼두고 잠금 해제된 화면에 접근할 기회를 기다릴 수 있다 — 규칙 주석이 단언하던 "`preferences`는 보안적 무게가 없다"가 거짓이 되는 지점이다. 면제로 남은 키는 `lastEntrySeq` 하나뿐이다(쓰기 경로가 읽기 게이트에 의존하면 안 되므로). 필드별로 "이건 보안, 저건 표시"로 나누지 않은 이유는 그런 규칙이 다음 필드 추가 때 조용히 열린 채로 남기 때문이다.

`autoLockMinutes`는 규칙에서 UI가 제공하는 값의 집합(`[0, 1, 5, 15, 30, 60]`)으로 고정된다. 범위가 아니라 열거인 이유는 `isValidWrappedSeed`가 PBKDF2 반복 횟수에 하한을 박아둔 것과 같다 — 클라이언트가 이 값을 그대로 보안 판단에 먹이므로, 이 코드베이스가 결코 만들지 않을 값(예: 100000)이 저장될 수 있다면 그건 조용히 "잠그지 않음"이 된다.

## 임시 저장 (작성 중인 일기) — 기본값 꺼짐

`/settings`에서 켜면 `/write`에서 쓰던 글이 기기에 임시 저장되어, 탭이 닫히거나 브라우저가 꺼져도 남는다(`lib/drafts.ts`). 일기를 저장하는 순간과 로그아웃하는 순간 즉시 지워지고, 복구된 임시 저장본이 있으면 화면에 "버리기" 버튼과 함께 항상 보인다 — 조용한 캐시가 아니다.

**기본값이 꺼짐인 이유**: 임시 저장본은 localStorage에 **평문**으로 들어간다. §1.1(서버는 평문을 못 본다)은 그대로이고 §1.3은 이미 로컬 기기를 위협 모델 밖에 두지만, 그 전까지 이 앱은 디스크에 아무것도 쓰지 않았다 — 남이 내 컴퓨터를 쓸 수 있다는 게 실제 걱정인 사람에게는 분명한 차이다. 일기 내용을 암호화 없이 기기에 쓰는 기능은 그 사실을 알고 켠 사람에게만 적용되어야지, 기본값으로 물려받는 것이어서는 안 된다. 끄면 이미 저장된 것도 함께 지우고, uid별로 분리되어 다른 계정으로 로그인해도 보이지 않는다.

대안이었던 "계정의 공개키로 임시 저장본을 암호화"(쓰기 경로는 이미 공개키를 갖고 있으므로 가능)는 자기모순이다 — 다시 읽으려면 시드 잠금 해제가 필요한데, 쓰기 경로는 바로 그걸 요구하지 않도록 설계된 곳이다.

## 계정 삭제

`/settings` 맨 아래 "계정 삭제"는 모든 일기 문서, `users/{uid}`, TOTP 시크릿, Firebase Auth 사용자까지 전부 지운다. 바로 위의 "초기화"와는 다르다 — **초기화**는 새 시드를 발급해 기존 암호문을 *읽을 수 없게* 만들 뿐 계정은 그대로 살아 있고(암호학적 소거), **계정 삭제**는 데이터와 로그인 자체를 없앤다. 오래 쓰는 일기 앱에는 둘 다 필요하다.

- 이 작업은 **클라이언트에서 구조적으로 불가능**하다. `firestore.rules`는 `users`와 `entries`의 delete를 무조건 거부한다(append-only, §5) — 세션을 쥔 누군가가 과거를 몰래 고쳐 쓰지 못하게 하는 규칙인데, 같은 규칙이 "내 데이터를 지우고 싶다"는 정당한 요청도 함께 막는다. 규칙을 느슨하게 푸는 대신, 규칙을 우회하는 Admin SDK(`functions/src/index.ts`의 `deleteAccount`)에서만 처리해 규칙 자체는 절대적으로 유지한다.
- **암호나 백업 코드는 요구하지 않는다.** 그건 "읽을 수 있음"의 증명인데 파괴에는 읽기 권한이 필요 없고, 요구하면 암호를 잊은 사람은 계정을 영영 닫지 못하게 된다. 반대로 **OTP가 켜져 있으면 현재 코드를 요구한다** — 세션 탈취에 대한 방어선이 OTP이고, 탈취된 세션이 할 수 있는 가장 파괴적인 일이 바로 이것이기 때문이다.
- 항목 삭제는 400건씩 페이지 단위로 처리한다(Firestore 배치 쓰기 상한이 500).
- 알아둘 한계: OTP 기기를 잃어버린 상태에서는 계정 삭제도 막힌다(`disableOtp`와 같은 성질). 백업 코드로 OTP 게이트를 통과해 `/settings`까지는 올 수 있지만, 이 함수는 별도로 유효한 TOTP 코드를 요구한다.

## 설치형 앱 (PWA)

`app/manifest.ts` + `app/icon.svg` / `app/apple-icon.png` / `app/favicon.ico`로 홈 화면에 설치할 수 있다. 일기는 매일 쓰는 개인적 습관인데 탭 서른 개 중 하나는 그걸 담기에 나쁜 그릇이고, `display: standalone`은 주소창도 없애준다 — 화면을 옆에서 볼 때 지금 뭘 보고 있는지 가장 크게 드러나는 게 주소창이라, 프라이빗 작성 모드(§3.9)와 같은 문제의식이다.

**서비스 워커는 일부러 등록하지 않았다.** 이 앱에서 오프라인 캐싱은 곧 (a) 암호문과 그걸 열 키 재료를, 또는 (b) 평문을 기기에 영구 저장한다는 뜻이다 — 임시 저장(`lib/drafts.ts`)에서 의도적으로 작게, 기기 단위로, 끌 수 있게 유지한 바로 그 트레이드오프다. 설치는 되지만 오프라인 캐시는 없는 지금 형태가 껍데기의 이점만 취하고 그 비용은 지지 않는다.

## DDoS / 남용 방지 (App Check는 도입했다가 제거함)

네트워크 볼륨 공격 자체는 Firestore/Cloud Functions가 Google 인프라(Cloud Run + Google Front End) 위에서 이미 흡수한다. 앱 코드가 실제로 손댈 수 있는 지점은 "공개된 Firebase 클라이언트 설정값(시크릿이 아니다)을 그대로 긁어다 스크립트로 두드리는" 종류의 남용뿐이다.

이걸 막으려고 **reCAPTCHA 기반 Firebase App Check**를 1차 방어선으로 붙였다가 완전히 걷어냈다(ARCHITECTURE.md §3.10). classic reCAPTCHA v3는 App Check 콘솔에서 신규 등록이 막혀 있어 reCAPTCHA Enterprise로 전환했고, 사이트 키·Enterprise API 활성화·App Check 등록까지 전부 맞췄지만 **Firestore 웹 SDK가 발급된 App Check 토큰을 요청에 아예 붙이지 않는 현상**을 프로덕션에서 확인했다(네트워크 탭에 `X-Firebase-AppCheck` 헤더 자체가 없음) — [firebase/flutterfire#18672](https://github.com/firebase/flutterfire/issues/18672)에 같은 증상이 보고된 미해결 Firebase JS SDK 버그로 보인다. Cloud Functions 쪽(별개의 직접 HTTPS 경로라 이 버그의 영향을 안 받음)은 정상 동작했지만, Firestore가 빠지면 봇 방지 효과가 절반뿐인 데다 Enterprise 설정의 운영 부담도 있어 관련 코드(`lib/firebase/appCheck.ts`, callable의 `enforceAppCheck`, `proxy.ts`의 CSP 예외, `NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY`/`APP_CHECK_ENFORCE` 환경변수)를 전부 삭제했다.

남은 방어선:

1. **Firestore 규칙의 항목 크기 상한** — `firestore.rules`의 `isValidEntry()`가 `entries` 쓰기의 `ciphertext`를 500,000자로 제한한다. 남용 트래픽의 빈도(rate)가 아니라 건당 크기(size)만 막는 저비용 방어선.
2. **OTP 실패 잠금** — `verifyStoredOtp`의 실패 5회/60초 잠금(Firestore 트랜잭션이라 동시 요청으로 우회 불가). 6자리 코드 추측 공격 전용.
3. 그 외에는 Firebase Authentication/Firestore 자체의 기본 요청 한도(quota)에 의존한다 — 개인용 규모에서는 감수할 만한 트레이드오프로 판단했다.

부수 효과로 CSP(`proxy.ts`)가 더 엄격해졌다: `script-src`에는 이제 제3자 호스트가 하나도 없고(이 앱은 외부 스크립트를 전혀 로드하지 않는다), `connect-src`도 Firestore·Auth·Cloud Functions만 남았다. `proxy.test.ts`가 이 상태를 회귀 테스트로 고정한다.

## Firestore 규칙 / Cloud Functions 배포

이 세션에서는 `firebase login`(브라우저 OAuth 필요)을 실행할 수 없어 아래는 사람이 직접 해야 한다.

```bash
firebase login
pnpm exec firebase deploy --only firestore:rules,firestore:indexes,functions --project <project-id>
```

- `firestore.rules`는 로컬 에뮬레이터로 이미 검증되어 있다 (`pnpm test:rules`).
- **Cloud Functions는 Firebase Blaze(종량제) 요금제가 필요하다** — Spark(무료) 요금제에서는 배포되지 않는다. Firebase 콘솔에서 결제 계정을 연결해 Blaze로 전환한 뒤 배포할 것. 이 앱 규모(개인용, 월 수십~수백 건의 OTP 검증)에서는 Cloud Functions 무료 한도(월 200만 건 호출) 안에 들어올 가능성이 높다.
- `deleteAccount`(계정 삭제)도 같은 배포 단위에 들어 있다 — 이 함수를 배포하지 않으면 `/settings`의 계정 삭제가 동작하지 않는다.
- `functions/`는 루트와 별도로 `npm install`한다 (Cloud Functions 배포 단위 관례) — `cd functions && npm install`.

## Vercel 배포

1. GitHub 저장소를 Vercel 프로젝트에 연결 (vercel.com에서 "Import Project").
2. Vercel 프로젝트 설정 > Environment Variables에 `.env.example`의 6개 `NEXT_PUBLIC_FIREBASE_*` 값을 등록 (Production/Preview/Development 모두). 이 6개가 전부이고, 그 외에 설정할 환경변수는 없다.
3. **Firebase 콘솔 > Authentication > Settings > Authorized domains에 Vercel 배포 도메인을 추가해야 로그인이 동작한다** (`*.vercel.app` 프리뷰 도메인 포함, 커스텀 도메인 사용 시 그것도 추가).
4. Next.js 앱(Vercel에 배포되는 쪽) 자체는 여전히 전부 클라이언트 사이드 Firebase SDK 호출만 하므로 Vercel 쪽에는 시크릿 환경변수가 전혀 없다. 서버 로직(OTP 검증)은 Vercel이 아니라 Firebase Cloud Functions에서 별도로 돌아간다 — 위 "Firestore 규칙 / Cloud Functions 배포" 참조.

## 보안 헤더 / CSP

`next.config.ts`에 정적 헤더(HSTS, X-Frame-Options 등), `proxy.ts`에 요청마다 새로 발급하는 CSP nonce가 있다. Next.js App Router의 하이드레이션 스크립트에 nonce를 붙이려면 페이지가 요청마다 렌더링되어야 하므로 `app/layout.tsx`에 `export const dynamic = "force-dynamic"`을 설정했다 (이 앱은 서버 데이터 의존성이 없는 클라이언트 앱이라 정적 생성의 이점이 크지 않고, 개인용 규모에서 요청마다 렌더링하는 비용은 무시할 만하다).
