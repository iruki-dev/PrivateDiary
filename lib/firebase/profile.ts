import { FirebaseError } from "firebase/app";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./config";
import { REAUTH_REQUIRED_MESSAGE, ReauthRequiredError } from "./reauth";

/**
 * The account's name and its password-reset email — nothing to do with the
 * diary's encryption (no lib/crypto here, like the rest of lib/firebase).
 *
 *  - `profiles/{uid}.nickname`: what the app calls its owner. Cosmetic, so
 *    firestore.rules lets the owner write it without reauthentication,
 *    like the display preferences.
 *  - `accountRecovery/{uid}.email`: where a reset link for the LOGIN
 *    password goes, for accounts that sign in with an id
 *    (lib/auth/loginId.ts). Clients can read their own but never write it:
 *    only the setRecoveryEmail function does, after checking that the
 *    session recently proved the login (or passed 2-step verification) —
 *    otherwise a stolen session could point the reset link at an address
 *    the thief reads and take over the login.
 */

export async function getNickname(uid: string): Promise<string | null> {
  const snapshot = await getDoc(doc(db, "profiles", uid));
  const nickname = snapshot.data()?.nickname;
  return typeof nickname === "string" && nickname.length > 0 ? nickname : null;
}

export async function setNickname(uid: string, nickname: string): Promise<void> {
  await setDoc(doc(db, "profiles", uid), { nickname, updatedAt: serverTimestamp() });
}

export async function getRecoveryEmail(uid: string): Promise<string | null> {
  const snapshot = await getDoc(doc(db, "accountRecovery", uid));
  const email = snapshot.data()?.email;
  return typeof email === "string" && email.length > 0 ? email : null;
}

/** 2-step verification is on and this session hasn't passed it recently. */
export class OtpRequiredError extends Error {
  constructor() {
    super("Verify the authenticator code first.");
    this.name = "OtpRequiredError";
  }
}

/**
 * Sets (or with null, removes) the password-reset email. Throws
 * ReauthRequiredError when the login has to be proven again first.
 */
export async function setRecoveryEmail(email: string | null): Promise<void> {
  const call = httpsCallable<{ email: string | null }, { email: string | null }>(functions, "setRecoveryEmail");
  try {
    await call({ email });
  } catch (err) {
    if (err instanceof FirebaseError && err.code === "functions/failed-precondition") {
      if (err.message === REAUTH_REQUIRED_MESSAGE) throw new ReauthRequiredError();
      if (err.message === "OTP_REQUIRED") throw new OtpRequiredError();
    }
    throw err;
  }
}

/**
 * Asks for a login-password reset link for an id account. Answers the same
 * whether or not the id exists or has a reset email, so this can't be used
 * to find out who has an account.
 */
export async function requestLoginPasswordReset(loginId: string): Promise<void> {
  const call = httpsCallable<{ loginId: string }, { ok: boolean }>(functions, "requestLoginPasswordReset");
  await call({ loginId });
}
