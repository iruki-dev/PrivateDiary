import { timingSafeEqual } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { generateSecret, generateURI, verify } from "otplib";
import { isAuthTimeFresh, REAUTH_REQUIRED_MESSAGE } from "./authFreshness";

/**
 * TOTP (OTP app) as a server-enforced access gate — NOT a cryptographic
 * factor combined into the diary's encryption. This is a deliberate,
 * discussed design choice: a 6-digit rotating code has too little entropy
 * to serve as key material, and the alternative (re-deriving a combined
 * wrapping key from the raw TOTP secret) would require the user to retype
 * that long secret every unlock, defeating the point of TOTP.
 *
 * Instead: the TOTP secret lives ONLY here (Cloud Functions + Firestore's
 * otpSecrets/{uid}, which firestore.rules denies all client access to —
 * never sent to nor readable by the browser after setup). startOtpSetup/
 * confirmOtpSetup/verifyOtp/disableOtp verify a code and, on success,
 * stamp the caller's Firebase Auth ID token with custom claims
 * (otpEnabled, otpVerified, otpVerifiedAt) that firestore.rules then
 * require before releasing `entries/{entryId}` reads (see
 * firestore.rules' otpSatisfied()). verifyShamirOtpBypass sets the same
 * claims via a structurally different proof — see its own doc comment —
 * so the Shamir recovery path never depends on OTP device availability.
 * The diary's zero-knowledge encryption (ARCHITECTURE.md rule 1-2) is
 * untouched by any of this: this whole module never sees the master
 * seed, a passphrase, Shamir shares, or plaintext — it only gates WHETHER
 * the (still fully client-side-decrypted) ciphertext can be fetched at all.
 */

initializeApp();

const OTP_ISSUER = "PrivateDiary";
const OTP_SECRETS_COLLECTION = "otpSecrets";
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;
const OTP_SESSION_MS = 12 * 60 * 60 * 1000; // 12h — how long a successful verify stays valid
// security-patch-v2: how recently the caller must have actually signed in
// (not just refreshed an existing ID token) to enroll OTP for the first
// time on this account — see authFreshness.ts and startOtpSetup below.
const REAUTH_MAX_AGE_MS = 5 * 60 * 1000;

interface OtpSecretDoc {
  secret: string;
  confirmed: boolean;
  createdAt: Timestamp;
  failedAttempts: number;
  lockedUntil: Timestamp | null;
  /**
   * security-patch-v2 (replay protection): the TOTP time step consumed by
   * the last successful verify, fed back in as `afterTimeStep` so the same
   * step can never validate twice — otplib's own documented pattern (see
   * its TOTP VerifyResult doc comment: "Save timeStep to prevent reuse").
   * Without this, a code observed once (shoulder-surfed, logged by a
   * proxy, read from a synced clipboard) stays replayable for the rest of
   * its ~90s acceptance window (epochTolerance below).
   * Optional: absent for accounts whose last successful verify predates
   * this field, and for freshly-created (never yet verified) docs.
   */
  lastUsedTimeStep?: number;
}

function requireAuth(uid: string | undefined): asserts uid is string {
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
}

function requireCode(data: unknown): string {
  const code = (data as { code?: unknown } | null)?.code;
  if (typeof code !== "string" || !/^\d{6,8}$/.test(code)) {
    throw new HttpsError("invalid-argument", "A numeric OTP code is required.");
  }
  return code;
}

function requireProof(data: unknown): string {
  const proof = (data as { proof?: unknown } | null)?.proof;
  if (typeof proof !== "string" || proof.length === 0) {
    throw new HttpsError("invalid-argument", "A proof string is required.");
  }
  return proof;
}

async function mergeClaims(uid: string, patch: Record<string, unknown>): Promise<void> {
  const user = await getAuth().getUser(uid);
  await getAuth().setCustomUserClaims(uid, { ...user.customClaims, ...patch });
}

/**
 * security-patch-v2: throws unless `request`'s ID token was minted from an
 * actual sign-in (not a refresh) within the last REAUTH_MAX_AGE_MS — see
 * authFreshness.ts's module doc for why this, rather than a passphrase
 * check, is the real fix for startOtpSetup's first-enroll hole. The
 * client (lib/firebase/otp.ts) matches on REAUTH_REQUIRED_MESSAGE
 * specifically to tell "please reauthenticate" apart from every other
 * failed-precondition this module throws.
 */
function requireRecentAuth(request: CallableRequest): void {
  const authTime = request.auth?.token.auth_time;
  if (typeof authTime !== "number" || !isAuthTimeFresh(authTime, Date.now(), REAUTH_MAX_AGE_MS)) {
    throw new HttpsError("failed-precondition", REAUTH_REQUIRED_MESSAGE);
  }
}

type VerifyStoredOtpOutcome =
  | { kind: "not-set-up" }
  | { kind: "locked-out" }
  | { kind: "wrong-code" }
  | { kind: "ok"; doc: FirebaseFirestore.DocumentReference; data: OtpSecretDoc };

/**
 * Verifies `code` against the stored secret for `uid`, enforcing a simple
 * lockout after repeated failures (a bare 6-digit TOTP code only has ~20
 * bits of entropy — without this, verifyOtp/disableOtp would be brute-
 * forceable by anyone who already has a valid signed-in session).
 *
 * security-patch-v2: the whole read-check-verify-write cycle now runs
 * inside one Firestore transaction. It used to be a plain read followed by
 * an update computed from that read — N concurrent calls could all read
 * the same failedAttempts value and each independently write attempts+1,
 * so a parallel brute-force burst could blow straight through
 * MAX_FAILED_ATTEMPTS without ever tripping the lockout. A transaction
 * serializes every read-modify-write against this document, closing that
 * race. It also now feeds the last consumed TOTP time step back in via
 * afterTimeStep, so a code that already succeeded once can never
 * succeed again for the rest of its acceptance window (replay protection
 * — see OtpSecretDoc.lastUsedTimeStep's doc comment).
 *
 * The transaction callback returns a plain outcome value and never
 * throws — a caught bug from the first draft of this fix: throwing INSIDE
 * a Firestore transaction callback aborts the whole transaction and
 * discards every write staged via tx.update() before the throw, exactly
 * like an uncommitted SQL transaction. The old code's plain (non-
 * transactional) `await ref.update(...); throw ...;` never had this
 * problem — `.update()` resolves and commits before the throw runs — so
 * moving straight to "stage the write, then throw" inside runTransaction
 * silently made the wrong-code write never persist at all: every failed
 * attempt still returned "Incorrect code." to the caller, but
 * failedAttempts stayed at 0 forever and the lockout could never trigger.
 * Caught by src/otpFlow.integration.test.ts's M4 test failing against a
 * real emulator, not by inspection. Throwing the actual HttpsError only
 * AFTER the transaction has resolved is what keeps the write and the
 * error correctly paired.
 */
async function verifyStoredOtp(
  uid: string,
  code: string
): Promise<{ doc: FirebaseFirestore.DocumentReference; data: OtpSecretDoc }> {
  const ref = getFirestore().collection(OTP_SECRETS_COLLECTION).doc(uid);

  const outcome: VerifyStoredOtpOutcome = await getFirestore().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      return { kind: "not-set-up" };
    }
    const data = snapshot.data() as OtpSecretDoc;

    if (data.lockedUntil && data.lockedUntil.toMillis() > Date.now()) {
      return { kind: "locked-out" };
    }

    const result = await verify({
      secret: data.secret,
      token: code,
      epochTolerance: 30,
      afterTimeStep: data.lastUsedTimeStep,
    });
    if (!result.valid) {
      const failedAttempts = (data.failedAttempts ?? 0) + 1;
      tx.update(ref, {
        failedAttempts,
        lockedUntil:
          failedAttempts >= MAX_FAILED_ATTEMPTS
            ? Timestamp.fromMillis(Date.now() + LOCKOUT_MS)
            : null,
      });
      return { kind: "wrong-code" };
    }

    // Only TOTP's VerifyResultValid carries `timeStep` (HOTP's doesn't) —
    // this module only ever verifies TOTP codes (no `counter` is ever
    // passed), but narrow structurally rather than assume the union member.
    const timeStep = "timeStep" in result ? result.timeStep : undefined;
    tx.update(ref, {
      failedAttempts: 0,
      lockedUntil: null,
      ...(timeStep !== undefined ? { lastUsedTimeStep: timeStep } : {}),
    });
    return { kind: "ok", doc: ref, data };
  });

  switch (outcome.kind) {
    case "not-set-up":
      throw new HttpsError("failed-precondition", "OTP is not set up for this account.");
    case "locked-out":
      throw new HttpsError(
        "resource-exhausted",
        "Too many incorrect attempts. Try again in a minute."
      );
    case "wrong-code":
      throw new HttpsError("permission-denied", "Incorrect code.");
    case "ok":
      return { doc: outcome.doc, data: outcome.data };
  }
}

// `invoker: "public"` is explicit rather than relying on onCall's normal
// default (which should already grant public invocation) because that
// default silently failed for these functions: they were returning a 403
// "Forbidden" straight from Google Frontend on every request — before ever
// reaching this code, hence no CORS headers on the OPTIONS preflight —
// meaning the underlying Cloud Run services' IAM invoker binding was
// missing allUsers. Deploying this config change alone did NOT fix it:
// firebase-tools only runs the IAM-binding step when a function is
// created, not on a code-only update to an existing one. Deleting and
// recreating all four functions (`firebase functions:delete ... &&
// firebase deploy --only functions`) re-ran that binding step and fixed
// it — confirmed via curl against the deployed URLs. Callable functions
// still check request.auth internally (see requireAuth below) regardless
// of this setting — it only controls whether the HTTP request is allowed
// to reach that check at all.

/**
 * Step 1 of setup: generates and stores a fresh (unconfirmed) secret,
 * returns it + a QR URI.
 *
 * Re-enrolling over an ALREADY-CONFIRMED authenticator requires a valid
 * current code, exactly like disableOtp. Without that check this function
 * was a complete bypass of the OTP gate: anyone holding nothing but a
 * stolen session could call it to overwrite the account's TOTP secret with
 * one it had just been handed, confirm that new secret, and verify it —
 * arriving at otpVerified claims (and therefore every entry's ciphertext)
 * without ever possessing the real authenticator. Overwriting the secret
 * also reset failedAttempts/lockedUntil, clearing verifyStoredOtp's
 * brute-force lockout as a side effect.
 *
 * security-patch-v2: enrolling for the FIRST time (no document, or a setup
 * that was started but never confirmed) USED to stay unauthenticated
 * beyond the session itself, on the reasoning that there's no OTP
 * credential to prove yet. That reasoning missed what confirming a
 * first-time enrollment actually grants: otpEnabled claims that make
 * firestore.rules' otpSatisfied() gate start demanding a code — one only
 * the caller who just ran this function knows. A session-only attacker
 * (stolen ID token, XSS — no passphrase, no Shamir shares) could enroll
 * an authenticator of their own choosing on a victim's account that never
 * had OTP, then the real owner can never satisfy the gate again:
 * disableOtp and every recovery path that touches wrappedSeed both
 * require otpSatisfied() or a valid current code, and the attacker holds
 * the only authenticator that can produce one. That's a permanent,
 * unrecoverable read lockout — worse than the already-fixed re-enroll
 * hole below, since Shamir's OTP-bypass can't help either (Shamir being
 * configured doesn't stop THIS attack from succeeding in the first
 * place). Since there's still no OTP credential to prove for a genuine
 * first enrollment, requireRecentAuth() below checks the one thing that
 * IS server-verifiable without breaking zero-knowledge (rule 1): that
 * this session's ID token was minted from an actual sign-in — proving the
 * LOGIN credential, not the passphrase — in the last few minutes, not
 * just carried forward by silent token refresh. See authFreshness.ts.
 */
export const startOtpSetup = onCall({ invoker: "public" }, async (request) => {
  requireAuth(request.auth?.uid);
  const uid = request.auth.uid;

  const existing = await getFirestore().collection(OTP_SECRETS_COLLECTION).doc(uid).get();
  if (existing.exists && (existing.data() as OtpSecretDoc).confirmed) {
    // Throws (and counts toward the lockout) unless the caller proves the
    // authenticator that is currently registered on this account.
    await verifyStoredOtp(uid, requireCode(request.data));
  } else {
    requireRecentAuth(request);
  }

  const secret = generateSecret();
  const email = request.auth.token.email ?? uid;

  await getFirestore()
    .collection(OTP_SECRETS_COLLECTION)
    .doc(uid)
    .set({
      secret,
      confirmed: false,
      createdAt: FieldValue.serverTimestamp(),
      failedAttempts: 0,
      lockedUntil: null,
    } satisfies Omit<OtpSecretDoc, "createdAt"> & { createdAt: FirebaseFirestore.FieldValue });

  const uri = generateURI({ issuer: OTP_ISSUER, label: email, secret });
  return { secret, uri };
});

/** Step 2 of setup: proves the user actually scanned the QR by requiring one valid code. */
export const confirmOtpSetup = onCall({ invoker: "public" }, async (request) => {
  requireAuth(request.auth?.uid);
  const uid = request.auth.uid;
  const code = requireCode(request.data);

  const { doc } = await verifyStoredOtp(uid, code);
  await doc.update({ confirmed: true });
  await mergeClaims(uid, { otpEnabled: true });
  return { success: true };
});

/** Verifies a code for the current session and stamps the auth token so Firestore rules allow reads. */
export const verifyOtp = onCall({ invoker: "public" }, async (request) => {
  requireAuth(request.auth?.uid);
  const uid = request.auth.uid;
  const code = requireCode(request.data);

  const { data } = await verifyStoredOtp(uid, code);
  if (!data.confirmed) {
    throw new HttpsError("failed-precondition", "OTP setup was never confirmed.");
  }
  await mergeClaims(uid, { otpEnabled: true, otpVerified: true, otpVerifiedAt: Date.now() });
  return { success: true, validForMs: OTP_SESSION_MS };
});

/**
 * Lets K-of-N Shamir shares satisfy the OTP gate without ever proving a
 * TOTP code (ARCHITECTURE.md §3.8). Forcing OTP on top of the Shamir
 * recovery path would mean losing the OTP device (or just not having it
 * on hand) could permanently block the one credential specifically meant
 * to survive losing everything else.
 *
 * `proof` is HKDF-SHA256(shamirWrapKey, "diary-shamir-otp-bypass-v1")
 * (lib/crypto/recovery.ts's computeShamirOtpBypassProof) — a one-way
 * value computed entirely client-side from shares combined locally. This
 * function never sees the shares, the wrap key, or the master seed; it
 * only compares `proof` against the matching verifier stored at Shamir
 * setup/reissue time (decryptionMethods.shamir.otpBypassVerifier). A
 * match is only reproducible by someone who actually combined ≥K real
 * shares: the wrap key is an independent random value the passphrase
 * path never touches, so knowing the passphrase alone cannot produce a
 * matching proof.
 *
 * On success this sets the exact same otpVerified/otpVerifiedAt claims
 * verifyOtp does, reusing firestore.rules' otpSatisfied() as-is — no
 * separate rule path needed for the bypass.
 */
export const verifyShamirOtpBypass = onCall({ invoker: "public" }, async (request) => {
  requireAuth(request.auth?.uid);
  const uid = request.auth.uid;
  const proof = requireProof(request.data);

  const snapshot = await getFirestore().collection("users").doc(uid).get();
  const stored = (
    snapshot.data() as { decryptionMethods?: { shamir?: { otpBypassVerifier?: string } } } | undefined
  )?.decryptionMethods?.shamir?.otpBypassVerifier;
  if (!stored) {
    throw new HttpsError("failed-precondition", "Shamir is not set up for this account.");
  }

  const storedBuf = Buffer.from(stored, "base64");
  const proofBuf = Buffer.from(proof, "base64");
  const matches = storedBuf.length === proofBuf.length && timingSafeEqual(storedBuf, proofBuf);
  if (!matches) {
    throw new HttpsError("permission-denied", "Proof did not match.");
  }

  await mergeClaims(uid, { otpVerified: true, otpVerifiedAt: Date.now() });
  return { success: true, validForMs: OTP_SESSION_MS };
});

/**
 * Disables OTP. Requires a currently-valid code — the same "prove the
 * current method" rule as recovery-key/Shamir changes.
 *
 * Also revokes every refresh token on the account. Turning off the second
 * factor is exactly the moment any other session still carrying
 * otpVerified/otpVerifiedAt claims should stop being trusted, and nothing
 * else in this codebase can invalidate a session that was already issued.
 * Note the residual window this cannot close: claims live inside the
 * signed Firebase ID token, so an ID token minted moments before this call
 * stays valid until it expires (<= 1h). Revocation stops it being renewed
 * past that.
 *
 * Cost of this: the caller's own device is signed out too — Firebase has
 * no "revoke every session except mine" — so the user re-authenticates
 * after disabling OTP. That is the intended trade.
 */
export const disableOtp = onCall({ invoker: "public" }, async (request) => {
  requireAuth(request.auth?.uid);
  const uid = request.auth.uid;
  const code = requireCode(request.data);

  const { doc } = await verifyStoredOtp(uid, code);
  await doc.delete();
  await mergeClaims(uid, { otpEnabled: false, otpVerified: false, otpVerifiedAt: null });
  await getAuth().revokeRefreshTokens(uid);
  return { success: true, sessionsRevoked: true };
});
