import { FirebaseError } from "firebase/app";
import { httpsCallable } from "firebase/functions";
import { functions } from "./config";

/**
 * Client wrappers for functions/src/index.ts's OTP callables. This module
 * — like the rest of lib/firebase — performs no cryptography and never
 * touches the master seed; OTP is a server-enforced access gate, not part
 * of the diary's encryption (see the Cloud Function's module doc for why).
 */

export class IncorrectOtpCodeError extends Error {
  constructor(message = "Incorrect code.") {
    super(message);
    this.name = "IncorrectOtpCodeError";
  }
}

export class OtpLockedOutError extends Error {
  constructor(message = "Too many incorrect attempts. Try again in a minute.") {
    super(message);
    this.name = "OtpLockedOutError";
  }
}

/** Shamir shares didn't reproduce a matching OTP-bypass proof — see verifyShamirOtpBypass. */
export class ShamirOtpBypassFailedError extends Error {
  constructor(message = "Shares did not match.") {
    super(message);
    this.name = "ShamirOtpBypassFailedError";
  }
}

/** Shamir isn't configured for this account, so there's no verifier to bypass OTP with. */
export class ShamirNotConfiguredError extends Error {
  constructor(message = "Shamir is not set up for this account.") {
    super(message);
    this.name = "ShamirNotConfiguredError";
  }
}

function rethrowOtpError(err: unknown): never {
  if (err instanceof FirebaseError) {
    if (err.code === "functions/permission-denied") throw new IncorrectOtpCodeError();
    if (err.code === "functions/resource-exhausted") throw new OtpLockedOutError();
  }
  throw err;
}

export interface OtpSetupMaterial {
  secret: string;
  /** otpauth:// URI — render as a QR code for the user's authenticator app. */
  uri: string;
}

/** Step 1 of enabling OTP: generates and server-side-stores a fresh secret. */
export async function startOtpSetup(): Promise<OtpSetupMaterial> {
  const call = httpsCallable<undefined, OtpSetupMaterial>(functions, "startOtpSetup");
  const result = await call();
  return result.data;
}

/** Step 2: proves the user scanned the QR by supplying one valid current code. */
export async function confirmOtpSetup(code: string): Promise<void> {
  const call = httpsCallable<{ code: string }, { success: boolean }>(functions, "confirmOtpSetup");
  try {
    await call({ code });
  } catch (err) {
    rethrowOtpError(err);
  }
}

/** Verifies a code for this session; on success the ID token must be force-refreshed to pick up the new claims. */
export async function verifyOtp(code: string): Promise<void> {
  const call = httpsCallable<{ code: string }, { success: boolean; validForMs: number }>(
    functions,
    "verifyOtp"
  );
  try {
    await call({ code });
  } catch (err) {
    rethrowOtpError(err);
  }
}

/** Disables OTP. Requires a currently-valid code (proof of possession, same rule as recovery-method changes). */
export async function disableOtp(code: string): Promise<void> {
  const call = httpsCallable<{ code: string }, { success: boolean }>(functions, "disableOtp");
  try {
    await call({ code });
  } catch (err) {
    rethrowOtpError(err);
  }
}

/**
 * Satisfies the OTP gate using a Shamir OTP-bypass proof instead of a TOTP
 * code (see functions/src/index.ts's verifyShamirOtpBypass). `proof` comes
 * from lib/crypto's computeShamirOtpBypassProof — this function never
 * touches shares, the wrap key, or the seed itself. On success the ID
 * token must be force-refreshed to pick up the new claims, same as verifyOtp.
 */
export async function verifyShamirOtpBypass(proof: string): Promise<void> {
  const call = httpsCallable<{ proof: string }, { success: boolean; validForMs: number }>(
    functions,
    "verifyShamirOtpBypass"
  );
  try {
    await call({ proof });
  } catch (err) {
    if (err instanceof FirebaseError) {
      if (err.code === "functions/permission-denied") throw new ShamirOtpBypassFailedError();
      if (err.code === "functions/failed-precondition") throw new ShamirNotConfiguredError();
    }
    throw err;
  }
}

/**
 * Permanently deletes the account and all of its data (see
 * functions/src/index.ts's deleteAccount for why this has to be a Cloud
 * Function rather than client-side Firestore deletes). `code` is required
 * only when OTP is enabled on the account.
 *
 * Lives in this module because it is the same thing every other function
 * here is: a call to the server-side gate. It performs no cryptography and
 * never touches the seed — it destroys ciphertext without ever reading it.
 */
export async function deleteAccount(code?: string): Promise<{ deletedEntries: number }> {
  const call = httpsCallable<{ code?: string }, { success: boolean; deletedEntries: number }>(
    functions,
    "deleteAccount"
  );
  try {
    const result = await call(code ? { code } : {});
    return { deletedEntries: result.data.deletedEntries };
  } catch (err) {
    rethrowOtpError(err);
  }
}
