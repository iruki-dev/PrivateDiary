import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, initializeFirestore, type Firestore } from "firebase/firestore";
import { getFunctions, type Functions } from "firebase/functions";

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

export const firebaseApp: FirebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

export const auth: Auth = getAuth(firebaseApp);

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
