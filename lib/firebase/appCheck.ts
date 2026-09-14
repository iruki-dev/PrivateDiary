import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import type { FirebaseApp } from "firebase/app";

/**
 * Firebase App Check: rejects Firestore/Functions requests that don't carry
 * a token proving they came from this actual web app (reCAPTCHA Enterprise
 * runs invisibly — no challenge, no friction — and only scores the
 * request), so it blocks scripted/bot abuse of the public Firebase config
 * without costing real users anything. This is the primary "don't hurt UX"
 * DDoS mitigation for this app; see README.md's "DDoS 방지" section for the
 * remaining manual steps (creating a reCAPTCHA Enterprise site key,
 * registering that SAME site key — not a secret key; Enterprise's App Check
 * registration screen only asks for the site key — under App Check's
 * "reCAPTCHA Enterprise" provider, enabling the reCAPTCHA Enterprise API
 * itself on the linked Google Cloud project, and flipping the per-API
 * "Enforce" toggle in the App Check console — none of that can be done
 * from code).
 *
 * Enterprise, not classic reCAPTCHA v3 (ReCaptchaV3Provider): as of this
 * writing, the App Check console no longer offers classic reCAPTCHA as a
 * registration option for new apps at all (not just deprecated — genuinely
 * unavailable to configure). The client-side API is otherwise identical
 * (same invisible-badge model, same constructor shape); Enterprise
 * additionally needs a billing-enabled Google Cloud project with the
 * reCAPTCHA Enterprise API (`recaptchaenterprise.googleapis.com`) enabled —
 * if that API is off, verification fails for every request even with a
 * correctly registered site key, which the App Check console's request
 * metrics surface as 100% "invalid requests" with no more specific error
 * client-side.
 *
 * Safe to call with no site key configured (dev, or before the console
 * setup is done): initializeAppCheck then just never succeeds in minting
 * tokens, so requests go out without one — identical to today, since
 * nothing enforces App Check server-side until enforceAppCheck/"Enforce" is
 * turned on (functions/src/index.ts, functions/.env's APP_CHECK_ENFORCE).
 */
export function initAppCheck(app: FirebaseApp): void {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

  if (process.env.NODE_ENV !== "production" && !siteKey) {
    // Lets `next dev` mint debug tokens (registered per-developer in the App
    // Check console under "Manage debug tokens") instead of a real
    // reCAPTCHA key, which is tied to specific domains and won't validate
    // from localhost. See https://firebase.google.com/docs/app-check/web/debug-provider.
    (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }

  if (!siteKey) return;

  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
}
