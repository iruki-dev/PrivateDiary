import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { auth } from "./config";

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

export async function signInWithGoogle(): Promise<User> {
  const credential = await signInWithPopup(auth, new GoogleAuthProvider());
  return credential.user;
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
  await reauthenticateWithPopup(user, new GoogleAuthProvider());
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth);
}
