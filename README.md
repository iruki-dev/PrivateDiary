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
    errors.ts      # WrongPassphraseError / TamperedCiphertextError / InvalidRecoveryKeyError / InvalidShamirSharesError
    types.ts       # 바이트 기반 타입(HybridKeyPair 등) + Firestore 저장용 base64 타입
    encoding.ts    # 의존성 없는 base64/base64url 인코딩
    memory.ts       # wipeBytes() — 세션 종료 시 키 폐기용
    aesGcm.ts        # Web Crypto AES-GCM 래퍼 (이 프로젝트에서 AES-GCM을 다루는 유일한 지점)
    random.ts         # generateMasterSeed()
    subSeeds.ts        # HKDF로 X25519/ML-KEM 하위 시드 파생
    keys.ts             # deriveHybridKeyPair() — 시드로부터 결정론적 키 쌍 재구성
    passphrase.ts        # wrapSeed / unwrapSeed / rewrapSeed (PBKDF2 + AES-GCM)
    recovery.ts            # 복구 키(랜덤 256비트 AES-GCM wrap) / Shamir 비밀 분산 — 니모닉 대체.
                            # 둘 다 옵트인이며, 재구성된 시드가 진짜인지는 seedMatchesPublicKeys()로
                            # 검증한다 (Firestore에 이미 저장된 publicKeys와 재파생 결과를 비교)
    hybridKem.ts             # encapsulateContentKey / decapsulateContentKey (X25519+ML-KEM-768)
    entry.ts                  # encryptEntry / decryptEntry (일기 항목 단위)
    codec.ts                   # 위 타입들의 base64 Firestore 저장 변환 (암호화 로직 없음)
    __tests__/                  # Vitest 단위 테스트

  firebase/          # Firebase Auth(이메일/비밀번호 + Google) / Firestore 클라이언트 연동.
                      # 평문·키를 다루지 않고, lib/crypto의 공개 API만 호출한다.
    config.ts, auth.ts, users.ts, entries.ts

  passphraseStrength.ts   # zxcvbn-ts 강도 추정 (lib/crypto 밖 — 암호화 연산이 아닌 UX 휴리스틱)

contexts/
  AuthContext.tsx    # Firebase 로그인 상태만 추적
  SeedContext.tsx     # 시드 상태(미발급/잠김/해제됨) + 복구 수단 상태 추적.
                       # unlock/lock/changePassphrase/resetKeys 외에, 복구 수단
                       # 생성/변경/제거를 위한 stage*/commit* 2단계 API 보유
                       # (생성은 패스프레이즈로, 변경·제거는 현재 설정된 복구
                       # 수단 자체로 증명해야 함)

components/
  SecretReveal.tsx              # "한 번만 보여주고 다시 못 봄" 공용 스캐폴드 (복구 키/Shamir 조각에 재사용)
  SecretCard.tsx                 # 복구 비밀 하나를 QR + 텍스트 + 다운로드로 표시
  PassphraseStrengthMeter.tsx

app/                  # Next.js App Router 페이지
  login/, signup/, settings/, write/, entries/

firestore.rules, firestore.indexes.json, firebase.json, .firebaserc
  Firestore 보안 규칙 및 에뮬레이터 설정 (ARCHITECTURE.md §5)

proxy.ts               # 요청마다 CSP nonce를 발급하는 Next.js Proxy(옛 middleware)
```

## 절대 규칙

이 저장소에서 작업할 때 지켜야 할 제약은 `ARCHITECTURE.md`에 정의되어 있다. 특히:

- 마스터 시드·개인키는 어떤 네트워크 요청/로그에도 포함되지 않는다.
- 서버(Vercel Functions 포함) 코드에는 복호화 로직이 존재하지 않는다. (WebAuthn을 쓰지 않기로 하면서 서버 사이드 코드 자체가 사실상 없다 — `proxy.ts`는 보안 헤더만 설정하고 크립토/Firebase 코드를 일절 import하지 않는다.)
- 모든 암호화 연산은 `lib/crypto/`를 통해서만 수행한다.

## 시드 백업 / 복구 수단

원래 설계(ARCHITECTURE.md §3.1)의 BIP39 24단어 니모닉은 제거했다. 대신 `/settings`에서 세 가지 중 선택할 수 있다.

- **없음 (기본값)** — 패스프레이즈만이 유일한 열쇠. 훔칠 백업 아티팩트 자체가 없어 가장 안전하지만, 패스프레이즈를 잊으면 정말로 복구 불가능.
- **복구 키** — 랜덤 256비트 키로 시드를 AES-GCM wrap해 Firestore에 저장(`recovery.wrappedSeed`). 키 자체는 한 번만 보여주고 어디에도 저장하지 않는다. QR/텍스트 파일로 내보낼 수 있다.
- **Shamir 비밀 분산** — 시드 자체를 N개 조각으로 분할, K개 이상 모아야 복구(`shamir-secret-sharing`, Cure53·Zellic 감사 완료 라이브러리, WASM 없음). Firestore에는 `(n, k)` 형태만 저장되고 조각 자체는 서버에 전혀 남지 않는다.

세 방식 모두 opt-in이며, 생성은 패스프레이즈로, **변경·제거는 현재 설정된 복구 수단 자체를 증명해야** 가능하다(2FA 설정 변경에 2FA를 요구하는 것과 같은 이유 — 패스프레이즈만 탈취당한 공격자가 복구 수단을 조용히 바꿔치기하지 못하게 함). 재구성된 시드가 진짜인지는 별도 저장 없이 `deriveHybridKeyPair(seed).publicKeys`를 Firestore에 이미 있는 공개키와 비교해서 검증한다(`seedMatchesPublicKeys`).

## Firestore 보안 규칙 배포

이 세션에서는 `firebase login`(브라우저 OAuth 필요)을 실행할 수 없어 아래는 사람이 직접 해야 한다.

```bash
firebase login
pnpm exec firebase deploy --only firestore:rules,firestore:indexes --project <project-id>
```

`firestore.rules`는 로컬 에뮬레이터로 이미 검증되어 있다 (`pnpm test:rules`).

## Vercel 배포

1. GitHub 저장소를 Vercel 프로젝트에 연결 (vercel.com에서 "Import Project").
2. Vercel 프로젝트 설정 > Environment Variables에 `.env.example`의 6개 `NEXT_PUBLIC_FIREBASE_*` 값을 등록 (Production/Preview/Development 모두).
3. **Firebase 콘솔 > Authentication > Settings > Authorized domains에 Vercel 배포 도메인을 추가해야 로그인이 동작한다** (`*.vercel.app` 프리뷰 도메인 포함, 커스텀 도메인 사용 시 그것도 추가).
4. 이 앱은 전부 클라이언트 사이드 Firebase SDK 호출만 하므로 (WebAuthn 미사용 → firebase-admin/서비스 계정 불필요) Vercel 쪽에는 시크릿 환경변수가 전혀 없다.

## 보안 헤더 / CSP

`next.config.ts`에 정적 헤더(HSTS, X-Frame-Options 등), `proxy.ts`에 요청마다 새로 발급하는 CSP nonce가 있다. Next.js App Router의 하이드레이션 스크립트에 nonce를 붙이려면 페이지가 요청마다 렌더링되어야 하므로 `app/layout.tsx`에 `export const dynamic = "force-dynamic"`을 설정했다 (이 앱은 서버 데이터 의존성이 없는 클라이언트 앱이라 정적 생성의 이점이 크지 않고, 개인용 규모에서 요청마다 렌더링하는 비용은 무시할 만하다).
