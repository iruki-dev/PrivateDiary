import { FirebaseError } from "firebase/app";
import { updateProfile } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "./config";
import { REAUTH_REQUIRED_MESSAGE, ReauthRequiredError } from "./reauth";

/**
 * The account's name and its password-reset email — nothing to do with the
 * diary's encryption (no lib/crypto here, like the rest of lib/firebase).
 *
 *  - The nickname: what the app calls its owner, kept as the Firebase Auth
 *    account's own display name. Cosmetic. Kept there rather than in a
 *    Firestore document on purpose: it is written with the account's own
 *    token through Firebase Auth, so it needs no security rule and works
 *    the instant the account exists. (A Firestore write sent right after
 *    createUserWithEmailAndPassword can still go out as the previous,
 *    signed-out identity and be refused — which is what a first version
 *    of this ran into.)
 *  - `accountRecovery/{uid}.email`: where a reset link for the LOGIN
 *    password goes, for accounts that sign in with an id
 *    (lib/auth/loginId.ts). Clients can read their own but never write it:
 *    only the setRecoveryEmail function does, after checking that the
 *    session recently proved the login (or passed 2-step verification) —
 *    otherwise a stolen session could point the reset link at an address
 *    the thief reads and take over the login.
 */

function signedInAs(uid: string) {
  const user = auth.currentUser;
  if (!user || user.uid !== uid) throw new Error("Not signed in as this account");
  return user;
}

/** For a Google account this starts out as the name Google gave; the owner can change it. */
export async function getNickname(uid: string): Promise<string | null> {
  const name = signedInAs(uid).displayName?.trim();
  return name ? name : null;
}

export async function setNickname(uid: string, nickname: string): Promise<void> {
  await updateProfile(signedInAs(uid), { displayName: nickname });
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
