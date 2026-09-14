/**
 * Pure "was this ID token minted from a recent sign-in?" check, split out
 * from index.ts (like lib/firebase/entrySequence.ts's split from
 * entries.ts) so it's unit-testable without booting firebase-admin.
 *
 * SECURITY CONTEXT (security-patch-v2): startOtpSetup's first-time-enroll
 * branch used to have no server-side check at all — enabling OTP on an
 * account that never had it required nothing but a valid session. A
 * session-only attacker (stolen ID token / XSS — no passphrase, no Shamir
 * shares, no knowledge of the login password) could enable OTP with a
 * secret only THEY know, then the real owner can never satisfy
 * firestore.rules' otpSatisfied() again: disableOtp requires a valid code
 * from the attacker's authenticator, and resetting the seed requires
 * otpSatisfied() too. That's a permanent, unrecoverable read lockout.
 *
 * The fix can't be "prove the passphrase" — this codebase deliberately has
 * no server-side passphrase check anywhere (lib/crypto/passphrase.ts's
 * unwrapSeed doc comment, §3.6 rule 1), since the server never learns it.
 * What the server CAN verify is Firebase Auth's own `auth_time` claim
 * (ARCHITECTURE.md rule 5: login is a separate concern from encryption,
 * and gating a login-security setting with a login-credential proof is
 * consistent with that split). `auth_time` is fixed to the moment of the
 * actual sign-in/reauthentication event and does NOT advance on ID token
 * refresh, so requiring it to be recent forces a real reauthentication
 * (which needs the login password or a fresh Google popup) — something a
 * pure token-theft attacker holding only an already-open session cannot
 * produce on demand.
 */

/**
 * `authTimeSeconds` — the decoded ID token's `auth_time` claim (Admin SDK
 * gives this in seconds since epoch, not milliseconds — see
 * firebase-admin's DecodedIdToken type).
 */
export function isAuthTimeFresh(
  authTimeSeconds: number,
  nowMs: number,
  maxAgeMs: number
): boolean {
  if (!Number.isFinite(authTimeSeconds)) return false;
  const ageMs = nowMs - authTimeSeconds * 1000;
  // A negative age (auth_time in the future) is clock skew at best and a
  // forged/malformed claim at worst — either way, not something to treat
  // as "fresh".
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

/** Sentinel HttpsError message the client (lib/firebase/otp.ts) matches on to know a reauth prompt, not a wrong code, is needed. */
export const REAUTH_REQUIRED_MESSAGE = "REAUTH_REQUIRED";
