# PrivateDiary for Android

The Android app is the same web app — same accounts, same end-to-end
encryption, same Firestore data — packaged inside a hardened native shell
that adds what a browser can't: hardware-backed biometric unlock, screen
protection and an app that only ever runs the code signed into it.

```
android/app/src/main/java/dev/iruki/privatediary/
  MainActivity.kt      window hardening, WebView setup, lifecycle → lock, back, insets
  SecureWebView.kt     keyboard incognito, tapjacking filter, accessibility sensitivity
  AppAssetServer.kt    serves the bundled pages from https://appassets.androidplatform.net
  AppOrigin.kt         the app origin and the network allowlist
  NativeBridge.kt      origin-checked page ↔ app channel (WebMessageListener)
  BridgeProtocol.kt    its wire format (JSON + binary frames for secrets)
  BiometricVault.kt    Keystore/StrongBox key, per-use BiometricPrompt, wrapped seed
  VaultBlob.kt         on-disk format of the wrapped seed
  SecureClipboard.kt   sensitive-flagged copy with auto-clear
  GoogleSignIn.kt      Credential Manager → Google ID token → Firebase
  DeviceSignals.kt     no screen lock / rooted / USB debugging warnings
lib/native/            the page's side of the bridge (TypeScript)
scripts/build-android-web.mjs   static export + per-page CSP pinning
```

## Build

Requirements: Node 24 + pnpm, JDK 17+, Android SDK (platform 36, build-tools 36).

```sh
# 1. The web app as static files, with every inline script pinned by hash.
#    Needs the same NEXT_PUBLIC_FIREBASE_* values as the website (.env.local
#    or the environment) — they are inlined at build time — and
#    NEXT_PUBLIC_SITE_URL, the website's https address: help, privacy and
#    terms aren't bundled; the app opens them there.
pnpm install
pnpm build:android-web

# 2. The app.
cd android
./gradlew testReleaseUnitTest lintRelease assembleRelease
```

Every `assemble*` run ends with `verify<Variant>WebAssets`, which fails
the build unless every file of the web bundle is inside the APK (Android's
packager drops `_`-prefixed folders such as `_next/` by default; the build
config overrides that).

`assembleDebug` installs as `dev.iruki.privatediary.debug` next to the real
app, with WebView inspection (`chrome://inspect`) enabled — never in release.

### Signing

Release signing comes from the environment, never from a file in the repo:

| Variable | |
|---|---|
| `ANDROID_KEYSTORE_PATH` | path to the upload/release keystore |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | |

Without them `assembleRelease` produces `app-release-unsigned.apk` to sign
separately (e.g. `apksigner`, or Play App Signing with an upload key).
v2/v3 signatures only; v1 (JAR) signing is off.

### Firebase setup for the app

1. **Google sign-in** (optional): set `GOOGLE_WEB_CLIENT_ID` when building
   — the *Web client* OAuth ID of the Firebase project (Firebase console →
   Authentication → Sign-in method → Google → Web SDK configuration). Also
   add an Android app to the Firebase project with package name
   `dev.iruki.privatediary` and the **SHA-1 and SHA-256 of the signing
   certificate** (Play App Signing key for Play builds), which registers the
   Android OAuth client Credential Manager needs. Without the variable the app
   hides "Google로 계속하기"; email accounts are unaffected, but accounts
   created with Google can't sign in to that build.
2. **API key restrictions**: if the browser API key is restricted by HTTP
   referrer, add `https://appassets.androidplatform.net/*`.
3. Nothing else changes: Firestore rules, Cloud Functions and the data model
   are shared with the website as-is.

### Supply chain

- `gradle/verification-metadata.xml` pins the SHA-256 of every Gradle
  dependency and plugin; a changed artifact fails the build. After changing
  a dependency, regenerate it with
  `./gradlew --write-verification-metadata sha256 testDebugUnitTest testReleaseUnitTest lintRelease assembleRelease assembleDebug`
  and review the diff.
- The Gradle wrapper distribution is pinned by checksum
  (`distributionSha256Sum`).
- Dependencies are AndroidX and Google Identity only; no analytics, ads,
  crash reporting or third-party SDKs.

## 테스트 배포 (Firebase App Distribution)

Play 스토어에 올리기 전까지 테스터 빌드는 Firebase App Distribution으로 배포합니다. GitHub의
**Actions → Android tester build → Run workflow** 한 번으로 빌드부터 테스트, 서명, 업로드까지
처리됩니다(`.github/workflows/android-distribute.yml`). 테스터는 Firebase App Tester 앱이나 초대
메일로 설치하고 업데이트를 받습니다.

### 버전 관리

| | 어디서 정하나 | 규칙 |
|---|---|---|
| 버전 이름 (`1.0.0`) | `android/version.properties` | 사람이 올립니다. 테스터에게 보일 의미 있는 변화가 쌓였을 때 MINOR/PATCH를 올리고, Play 출시 직전에 확정합니다. |
| 빌드 번호 (`42`) | 배포 워크플로가 자동으로 | 실행할 때마다 1씩 커집니다(`ANDROID_VERSION_CODE_BASE` + 실행 번호). 줄어드는 일이 없어 테스터 휴대폰은 항상 위에 덮어 설치됩니다. Play에 올릴 때도 같은 번호 체계를 그대로 이어 씁니다. |
| 커밋 | 빌드 시 자동 | 앱에 함께 기록됩니다. |

테스터의 앱에서 **설정 → 계정 → 앱 버전**에 `1.0.0 (42) · abc1234`처럼 표시됩니다. 문제를 알려 줄 때
이 줄을 같이 보내 달라고 안내하면 정확히 어떤 코드인지 알 수 있습니다. 같은 내용이 App Distribution의
릴리스 노트 첫 줄과 워크플로 실행 요약에도 남습니다.

로컬 빌드는 빌드 번호가 1이고 디버그 빌드는 패키지 이름도 다르므로(`.debug`), 테스터 빌드와 섞이지
않습니다.

### 처음 한 번 설정

1. **Firebase에 Android 앱 등록**: Firebase 콘솔 → 프로젝트 설정 → 앱 추가 → Android, 패키지 이름
   `dev.iruki.privatediary`. `google-services.json`은 받지 않아도 됩니다(앱은 Firebase Android SDK를
   쓰지 않습니다). 표시되는 **앱 ID**(`1:…:android:…`)를 적어 둡니다.
2. **테스터 그룹**: App Distribution → 테스터 및 그룹 → 그룹을 만들고 별칭을 `testers`로 둡니다(다른
   이름이면 실행할 때 입력합니다).
3. **업로드 키 만들기** (평생 쓰는 키이므로 신중히):
   ```sh
   keytool -genkeypair -keystore privatediary-upload.jks -alias upload \
     -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=PrivateDiary"
   base64 -w0 privatediary-upload.jks   # → ANDROID_KEYSTORE_BASE64
   ```
   키 파일과 비밀번호는 비밀번호 관리자와 오프라인 백업에 보관합니다. 잃어버리면 같은 앱으로
   업데이트를 낼 수 없습니다(Play 출시 후에는 Play App Signing 덕분에 업로드 키를 재설정할 수 있습니다).
4. **업로드용 서비스 계정**: Google Cloud 콘솔(같은 프로젝트) → IAM 및 관리자 → 서비스 계정 → 만들기,
   역할은 **Firebase App Distribution Admin** 하나만 줍니다. 키(JSON)를 만들어 내용 전체를
   `FIREBASE_APP_DISTRIBUTION_CREDENTIALS`에 넣고, 내려받은 파일은 지웁니다.
5. **GitHub 환경**: 저장소 Settings → Environments → `app-distribution` 만들기.
   - *Required reviewers*에 본인(또는 다른 사람)을 넣으면, 승인 없이는 테스터에게 아무것도 나가지 않습니다.
   - *Deployment branches*를 `main`으로 제한하는 것을 권장합니다.
   - Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`(`upload`),
     `ANDROID_KEY_PASSWORD`, `FIREBASE_APP_DISTRIBUTION_CREDENTIALS`
   - Variables: `FIREBASE_ANDROID_APP_ID`, 웹과 같은 `NEXT_PUBLIC_FIREBASE_*` 여섯 개,
     `NEXT_PUBLIC_SITE_URL`(**필수** — 웹사이트의 https 주소. 앱의 도움말·개인정보처리방침·이용약관
     링크가 이 주소로 열립니다), `NEXT_PUBLIC_OPERATOR_NAME`·`NEXT_PUBLIC_CONTACT_EMAIL`,
     `GOOGLE_WEB_CLIENT_ID`(Google 로그인을 쓸 때), `ANDROID_VERSION_CODE_BASE`(선택, 기본 0)
6. **첫 실행 후**: 워크플로의 *Verify signature and version* 단계 로그에 찍힌 인증서 SHA-1·SHA-256을
   Firebase의 Android 앱 설정 → 디지털 지문 추가에 등록합니다. Google 로그인에 필요합니다.

### 배포하기

Actions → **Android tester build** → Run workflow → 브랜치(보통 `main`), 테스터 그룹, 릴리스 노트(비우면
최근 커밋 제목) → 승인 → 몇 분 뒤 테스터에게 알림이 갑니다.

### Play 스토어로 넘어갈 때

- Play App Signing을 쓰면 Play에서 받은 앱은 Google의 앱 서명 키로 서명됩니다. App Distribution으로 설치한
  앱(업로드 키 서명)과 서명이 달라 **그 위로 업데이트되지 않습니다.** 테스터는 앱을 지우고 Play에서 다시
  설치해야 합니다. 일기는 서버에 있으므로 다시 로그인하면 그대로 보이고, 생체 인증으로 열기만 다시 켜면
  됩니다.
- Play Console의 앱 서명 키 SHA-1·SHA-256도 Firebase에 등록합니다(Google 로그인).
- 빌드 번호는 이어서 올라가므로 따로 맞출 필요가 없습니다.

App Distribution SDK(앱 안의 "새 버전" 알림)는 넣지 않았습니다. 앱이 통신하는 곳이 늘고 SDK가 하나 더
들어오는 데 비해, 같은 알림을 App Tester 앱이 이미 줍니다.

## Security model

Threats are what a phone adds on top of the website's threat model (the
encryption itself is unchanged — see `/docs/how-it-works`). OWASP MASVS
categories in brackets.

| Threat | Protection |
|---|---|
| Server (or whoever controls it) serves modified JavaScript that leaks the passphrase | The whole web app ships inside the signed APK and is served locally from `appassets.androidplatform.net`; no page or script is ever fetched. [CODE] |
| Injected script / XSS in the page | Per-page CSP pinning every inline script by SHA-256; no `unsafe-inline`, no `unsafe-eval`, `frame-src`/`form-action`/`base-uri`/`object-src`/`worker-src` all `'none'`. The build fails on anything that would need a weaker policy. [PLATFORM] |
| Page talks to a host it shouldn't | CSP `connect-src` **and** a native allowlist in `shouldInterceptRequest`: only Firestore, Firebase Auth and Cloud Functions hosts; everything else gets 403. Top-level navigation off the app origin is blocked; tapped https/mailto links open outside the app. [NETWORK] |
| Traffic interception | HTTPS only; user-installed CAs are not trusted (`network_security_config.xml`). No certificate pinning — Google rotates Firebase certificates, and entries are end-to-end encrypted regardless. [NETWORK] |
| Copying app data off the phone (backup, device transfer, a stolen unlocked phone over USB) | `allowBackup=false`, data-extraction rules exclude every domain from cloud backup **and** device-to-device transfer. The biometric-wrapped seed is useless without the phone's secure hardware. [STORAGE] |
| Someone holding the phone reads the diary | Leaving the app locks the diary immediately (keys wiped from memory). Reading needs the passphrase, backup codes, or a fresh Class 3 biometric match. [AUTH] |
| Biometric unlock key theft or misuse | AES-256-GCM key generated in Android Keystore — StrongBox if present, else TEE; software-only keystores refused. Per-use authentication bound with `CryptoObject` (no validity window), `BIOMETRIC_STRONG` only (no PIN fallback), invalidated when a biometric is enrolled, unusable while the device is locked, ciphertext bound to the account via GCM AAD. [CRYPTO, AUTH] |
| Screenshots, screen recording, recents thumbnail, casting | `FLAG_SECURE`, `setRecentsScreenshotEnabled(false)`. [PLATFORM] |
| Tapjacking / fake overlays over the passphrase field | `setHideOverlayWindows(true)` (`HIDE_OVERLAY_WINDOWS`), `filterTouchesWhenObscured`. [PLATFORM] |
| Keyboard learning or syncing diary text and passphrases | `IME_FLAG_NO_PERSONALIZED_LEARNING` on every input connection. [PRIVACY] |
| Spyware abusing accessibility services | `ACCESSIBILITY_DATA_SENSITIVE_YES` (Android 14+): only real accessibility tools (e.g. TalkBack) can read the screen. [PRIVACY] |
| The diary passphrase ending up stored by a password manager or keyboard | Passphrase fields carry no password-manager hints (`autocomplete="off"` plus each manager's ignore attribute). Android autofill is off for the whole WebView unless the page allows it, which it does only for the login password and never while a passphrase field is mounted; turning it off cancels any session in progress (`lib/native/autofill.ts`). "보기" is read-only, so a passphrase is only ever typed into a masked field. [STORAGE, PRIVACY] |
| Password managers / autofill services receiving diary text | Same switch: autofill is off everywhere except the login password. [PRIVACY] |
| Clipboard leaking backup codes | Copied with `EXTRA_IS_SENSITIVE` (hidden from previews and keyboard clipboard history) and cleared after 30 s if still ours. [STORAGE] |
| Malicious page or frame calling native code | `WebMessageListener` injected only for the exact app origin; every message re-checked for origin and main frame; a fixed list of methods; secrets travel as zeroable binary frames, never as JSON strings. [PLATFORM] |
| Task hijacking (StrandHogg) | `taskAffinity=""`, single exported activity. [PLATFORM] |
| Leaking through logs or debugging | Release builds strip `android.util.Log`, swallow page console output, and disable WebView inspection. [CODE] |
| Rooted / unprotected phone | Warned about in-app (no screen lock, root indicators, USB debugging). Not blocked: root detection is easy to evade and isn't relied on. [RESILIENCE] |
| OAuth phishing inside a WebView | Google sign-in runs through Android's Credential Manager; the page only receives an ID token. Firebase Auth is initialised without its popup/redirect resolver, so its hidden iframe is never loaded. [AUTH] |

### Deliberately not done

- **Certificate pinning** — see above.
- **Blocking rooted devices** or Play Integrity enforcement — needs a server
  verdict check, punishes legitimate users, and is routinely bypassed; the
  data's protection doesn't depend on it.
- **Offline cache of entries** — the app stores no diary content on the
  phone beyond what the website stores (the opt-in plaintext draft).

## Testing

- `./gradlew testDebugUnitTest` — JVM tests for path resolution, the network
  allowlist, the bridge wire format, the vault blob format and file names.
- `pnpm test` — includes `lib/native/__tests__/bridge.test.ts` (the page side
  of the bridge) and `scripts/__tests__/android-csp.test.ts` (the CSP).
- On a device: install a debug build, then check — screenshots blocked;
  recents shows a blank card; home → back locks 지난 일기; enabling 생체
  인증으로 열기 → adding a new fingerprint in system settings → the app
  asks for the passphrase again and the switch is off.
