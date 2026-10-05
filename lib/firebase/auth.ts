import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { auth } from "./config";
import { isNativeApp } from "@/lib/native/bridge";
import { googleIdToken } from "@/lib/native/app";

/**
 * Firebase Authentication only (ARCHITECTURE.md §2: "계정 로그인(신원 확인)만
 * 담당"). Nothing in this file ever touches lib/crypto — login state and
 * seed/key state are deliberately separate concerns (rule 5), reconciled
 * only in contexts/SeedContext.tsx.
 *
 * Two sign-in methods, matching what was enabled in the Firebase console:
 * email/password and Google. Note for Phase 4 onboarding: ARCHITECTURE.md
 * §3.6 rule 2 (passphrase must differ from the login password) only applies
 * to the email/password path — Google-authenticated users have no login
 * password to compare against.
 */

export async function signUpWithEmail(email: string, password: string): Promise<User> {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  return credential.user;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

/**
 * Web: Google's popup. Android app: Google refuses its sign-in page inside
 * a WebView, so the app gets a Google ID token from Android's Credential
 * Manager and only that token is exchanged with Firebase here.
 */
export async function signInWithGoogle(): Promise<User> {
  if (isNativeApp()) {
    const credential = await signInWithCredential(auth, GoogleAuthProvider.credential(await googleIdToken()));
    return credential.user;
  }
  const credential = await signInWithPopup(auth, new GoogleAuthProvider());
  return credential.user;
}

/**
 * Resets the LOGIN password only. The diary passphrase is a different
 * secret that never reaches Firebase (rule 5), so nothing here can reset
 * it — the UI that calls this must say so. Resolves the same way whether
 * or not the address has an account (Firebase's email enumeration
 * protection), so the caller can't and shouldn't tell the two apart.
 */
export async function sendLoginPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}

export function subscribeToAuthState(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

/**
 * security-patch-v2: proves the LOGIN password again, refreshing the ID
 * token's `auth_time` claim to "now" — functions/src/index.ts's
 * requireRecentAuth (C2 fix) checks this before letting a session enroll
 * OTP for the first time on an account, since the passphrase can't be
 * checked server-side (rule 1) but the login credential can be. Only
 * meaningful for email/password accounts; call reauthenticateWithGoogle
 * for a Google-signed-in user instead.
 */
export async function reauthenticateWithPassword(user: User, password: string): Promise<void> {
  if (!user.email) {
    throw new Error("This account has no email/password credential to reauthenticate with");
  }
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
}

/** Same as reauthenticateWithPassword, for a Google-signed-in user (re-runs the Google popup). */
export async function reauthenticateWithGoogle(user: User): Promise<void> {
  if (isNativeApp()) {
    await reauthenticateWithCredential(user, GoogleAuthProvider.credential(await googleIdToken()));
    return;
  }
  await reauthenticateWithPopup(user, new GoogleAuthProvider());
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth);
}
