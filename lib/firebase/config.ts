import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getFunctions, type Functions } from "firebase/functions";
import { initAppCheck } from "./appCheck";

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

// Every route that imports this module is a client component (app/layout.tsx's
// force-dynamic doc comment), so this always runs in the browser in
// practice — the guard is only for build-time module evaluation.
if (typeof window !== "undefined") {
  initAppCheck(firebaseApp);
}

export const auth: Auth = getAuth(firebaseApp);
export const db: Firestore = getFirestore(firebaseApp);
/** Backs the OTP callable functions (functions/src/index.ts) — an access gate, not part of the crypto surface. */
export const functions: Functions = getFunctions(firebaseApp);
