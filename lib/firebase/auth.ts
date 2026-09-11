import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
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

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth);
}
