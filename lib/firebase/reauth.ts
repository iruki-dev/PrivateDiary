/**
 * Shared by lib/firebase/otp.ts and lib/firebase/users.ts — both need to
 * tell "the server wants a fresh login proof" apart from every other
 * failure their respective calls can produce.
 *
 * security-patch-v2 / C1 & C2: this codebase has no server-side passphrase
 * check anywhere (lib/crypto/passphrase.ts's unwrapSeed doc comment, rule
 * 1) — the server never learns it, by design. What Firebase Auth's ID
 * token DOES carry, and what both firestore.rules and
 * functions/src/index.ts can verify, is the `auth_time` claim: it only
 * advances on an actual sign-in, never on silent token refresh, so
 * requiring it to be recent forces proof of the LOGIN credential — the one
 * thing a pure token-theft attacker (holding an already-open session, but
 * not the login password) cannot produce on demand. See:
 *   - functions/src/authFreshness.ts (Cloud Functions side, C2: blocks a
 *     session-only attacker from enrolling their own OTP on a victim's
 *     never-OTP account).
 *   - firestore.rules' isRecentAuth() (rules side, C1: blocks a
 *     session-only attacker from overwriting wrappedSeed/publicKeys/
 *     decryptionMethods on an account that hasn't opted into OTP).
 */
export class ReauthRequiredError extends Error {
  constructor(message = "Please sign in again to continue.") {
    super(message);
    this.name = "ReauthRequiredError";
  }
}

// Must match functions/src/authFreshness.ts's REAUTH_REQUIRED_MESSAGE
// exactly — the Cloud Functions package and this Next.js app don't share a
// module, so this is duplicated by convention rather than import, the same
// way lib/crypto's HKDF info strings are duplicated as literals rather
// than shared across packages.
export const REAUTH_REQUIRED_MESSAGE = "REAUTH_REQUIRED";
