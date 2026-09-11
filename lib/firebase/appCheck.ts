import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import type { FirebaseApp } from "firebase/app";

/**
 * Firebase App Check: rejects Firestore/Functions requests that don't carry
 * a token proving they came from this actual web app (reCAPTCHA v3 runs
 * invisibly — no challenge, no friction — and only scores the request), so
 * it blocks scripted/bot abuse of the public Firebase config without
 * costing real users anything. This is the primary "don't hurt UX" DDoS
 * mitigation for this app; see README.md's "DDoS 방지" section for the
 * remaining manual steps (creating a reCAPTCHA v3 site key and flipping the
 * per-API "Enforce" toggle in the App Check console — neither can be done
 * from code).
 *
 * Safe to call with no site key configured (dev, or before the console
 * setup is done): initializeAppCheck then just never succeeds in minting
 * tokens, so requests go out without one — identical to today, since
 * nothing enforces App Check server-side until enforceAppCheck/"Enforce" is
 * turned on (functions/src/index.ts, functions/.env's APP_CHECK_ENFORCE).
 */
export function initAppCheck(app: FirebaseApp): void {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY;

  if (process.env.NODE_ENV !== "production" && !siteKey) {
    // Lets `next dev` mint debug tokens (registered per-developer in the App
    // Check console under "Manage debug tokens") instead of a real
    // reCAPTCHA key, which is tied to specific domains and won't validate
    // from localhost. See https://firebase.google.com/docs/app-check/web/debug-provider.
    (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }

  if (!siteKey) return;

  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
}
