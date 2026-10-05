import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, indexedDBLocalPersistence, initializeAuth, type Auth } from "firebase/auth";
import { getFirestore, initializeFirestore, type Firestore } from "firebase/firestore";
import { getFunctions, type Functions } from "firebase/functions";
import { IS_ANDROID_APP } from "@/lib/platform";

/**
 * These NEXT_PUBLIC_* values are not secrets — Firebase's client config is
 * meant to be embedded in the shipped bundle. Access control is enforced by
 * Firestore security rules and Firebase Auth, not by hiding this object.
 * See README.md / .env.example for where these come from.
 */
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/**
 * NEXT_PUBLIC_* values are inlined at BUILD time, so a deployment built
 * without them (e.g. a Vercel environment whose variables are scoped to
 * Production only, then used for a Preview) still builds "Ready" and then
 * fails on every request — as an opaque 500 on the server and Firebase's
 * terse `auth/invalid-api-key` in the browser. Name the missing variables
 * instead, so the runtime log says exactly what to set.
 */
const missingConfig = Object.entries({
  NEXT_PUBLIC_FIREBASE_API_KEY: firebaseConfig.apiKey,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: firebaseConfig.authDomain,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: firebaseConfig.projectId,
  NEXT_PUBLIC_FIREBASE_APP_ID: firebaseConfig.appId,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missingConfig.length > 0) {
  throw new Error(
    `Firebase configuration missing at build time: ${missingConfig.join(", ")}. ` +
      "Set them for this deployment's environment (on Vercel: Settings → Environment Variables, " +
      "including Preview) and redeploy — they are inlined during the build."
  );
}

export const firebaseApp: FirebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

/**
 * The Android app signs in to Google natively (lib/native/google.ts) and
 * never opens Firebase's popup/redirect flow, so it initialises Auth
 * WITHOUT the popup/redirect resolver: nothing in the app can then load
 * Firebase's hidden auth iframe at all (its CSP has frame-src 'none').
 * The session persists in the app's own sandboxed IndexedDB.
 */
export const auth: Auth = IS_ANDROID_APP
  ? (() => {
      try {
        return initializeAuth(firebaseApp, { persistence: indexedDBLocalPersistence });
      } catch {
        return getAuth(firebaseApp);
      }
    })()
  : getAuth(firebaseApp);

/**
 * `experimentalAutoDetectLongPolling` (Firestore Web SDK): probes once
 * whether the browser's normal streaming connection (fetch streams/WebChannel)
 * actually works and falls back to long-polling if not, instead of assuming
 * streaming always works. Without this, Firestore defaults to assuming
 * streaming works — which silently breaks reads/writes in browsers or
 * network setups that interfere with streaming connections (privacy-hardened
 * browsers' shields, some corporate proxies/VPNs) while working fine
 * elsewhere, a well-documented Firestore Web SDK gotcha. `initializeFirestore`
 * throws if called twice for the same app (e.g. Next.js Fast Refresh
 * re-evaluating this module in dev) — falling back to getFirestore() in that
 * case just returns the already-initialized instance.
 */
export const db: Firestore = (() => {
  try {
    return initializeFirestore(firebaseApp, { experimentalAutoDetectLongPolling: true });
  } catch {
    return getFirestore(firebaseApp);
  }
})();
/** Backs the OTP callable functions (functions/src/index.ts) — an access gate, not part of the crypto surface. */
export const functions: Functions = getFunctions(firebaseApp);
