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
