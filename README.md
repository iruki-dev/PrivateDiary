# PrivateDiary

제로 지식 암호화 일기장. 서버(Firebase, Vercel)는 어떤 시점에도 평문이나 복호화 키를 볼 수 없다. 전체 설계는 `ARCHITECTURE.md`(로컬 전용, git에는 커밋되지 않음)를 참조.

## 개발 환경

```bash
pnpm install
pnpm dev      # 개발 서버 (http://localhost:3000)
pnpm test     # lib/crypto 단위 테스트 (Vitest)
pnpm lint     # ESLint
pnpm exec tsc --noEmit   # 타입 체크
```

## 디렉터리 구조

```
lib/
  crypto/          # 모든 암호화·복호화·키 파생 로직. 네트워크/Firebase를 일절 import하지 않는
                    # 순수 함수 모듈. 다른 코드는 반드시 lib/crypto/index.ts를 통해서만 이
                    # 모듈의 기능을 사용한다 (감사 용이성 확보를 위한 단일 진입점).
    index.ts       # 공개 API 배럴 — 이 파일 외부에서 개별 파일을 직접 import하지 않는다
    constants.ts   # 알고리즘 버전 태그, KDF 반복 횟수 등 상수
    errors.ts      # WrongPassphraseError / TamperedCiphertextError / InvalidMnemonicError
    types.ts       # 바이트 기반 타입(HybridKeyPair 등) + Firestore 저장용 base64 타입
    encoding.ts    # 의존성 없는 base64/base64url 인코딩
    memory.ts       # wipeBytes() — 세션 종료 시 키 폐기용
    aesGcm.ts        # Web Crypto AES-GCM 래퍼 (이 프로젝트에서 AES-GCM을 다루는 유일한 지점)
    random.ts         # generateMasterSeed()
    subSeeds.ts        # HKDF로 X25519/ML-KEM 하위 시드 파생
    keys.ts             # deriveHybridKeyPair() — 시드로부터 결정론적 키 쌍 재구성
    mnemonic.ts          # 32바이트 시드 ↔ BIP39 24단어 변환
    passphrase.ts         # wrapSeed / unwrapSeed / rewrapSeed (PBKDF2 + AES-GCM)
    hybridKem.ts           # encapsulateContentKey / decapsulateContentKey (X25519+ML-KEM-768)
    entry.ts                # encryptEntry / decryptEntry (일기 항목 단위)
    codec.ts                 # 위 타입들의 base64 Firestore 저장 변환 (암호화 로직 없음)
    __tests__/                # Vitest 단위 테스트

  firebase/         # (예정) Firebase Auth / Firestore 클라이언트 연동. 평문·키를 다루지 않음.

app/                 # Next.js App Router 페이지/컴포넌트
```

## 절대 규칙

이 저장소에서 작업할 때 지켜야 할 제약은 `ARCHITECTURE.md`에 정의되어 있다. 특히:

- 마스터 시드·개인키는 어떤 네트워크 요청/로그에도 포함되지 않는다.
- 서버(Vercel Functions 포함) 코드에는 복호화 로직이 존재하지 않는다.
- 모든 암호화 연산은 `lib/crypto/`를 통해서만 수행한다.
