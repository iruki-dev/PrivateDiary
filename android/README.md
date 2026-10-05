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
#    or the environment) — they are inlined at build time.
pnpm install
pnpm build:android-web

# 2. The app.
cd android
./gradlew testReleaseUnitTest lintRelease assembleRelease
```

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
| Password managers / autofill services receiving diary text | Autofill is excluded for the whole WebView except on `/login` and `/signup`. [PRIVACY] |
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
