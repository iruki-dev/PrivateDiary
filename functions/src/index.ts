import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { generateSecret, generateURI, verify } from "otplib";

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
 * never sent to nor readable by the browser after setup). This function
 * verifies a code and, on success, stamps the caller's Firebase Auth ID
 * token with custom claims (otpEnabled, otpVerified, otpVerifiedAt) that
 * firestore.rules then require before releasing `users/{uid}` or
 * `entries/{entryId}` reads. The diary's zero-knowledge encryption
 * (ARCHITECTURE.md rule 1-2) is untouched by any of this: this whole
 * module never sees the master seed, a passphrase, or plaintext — it only
 * gates WHETHER the (still fully client-side-decrypted) ciphertext can be
 * fetched at all.
 */

initializeApp();

const OTP_ISSUER = "PrivateDiary";
const OTP_SECRETS_COLLECTION = "otpSecrets";
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;
const OTP_SESSION_MS = 12 * 60 * 60 * 1000; // 12h — how long a successful verify stays valid

interface OtpSecretDoc {
  secret: string;
  confirmed: boolean;
  createdAt: Timestamp;
  failedAttempts: number;
  lockedUntil: Timestamp | null;
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

async function mergeClaims(uid: string, patch: Record<string, unknown>): Promise<void> {
  const user = await getAuth().getUser(uid);
  await getAuth().setCustomUserClaims(uid, { ...user.customClaims, ...patch });
}

/**
 * Verifies `code` against the stored secret for `uid`, enforcing a simple
 * lockout after repeated failures (a bare 6-digit TOTP code only has ~20
 * bits of entropy — without this, verifyOtp/disableOtp would be brute-
 * forceable by anyone who already has a valid signed-in session).
 */
async function verifyStoredOtp(
  uid: string,
  code: string
): Promise<{ doc: FirebaseFirestore.DocumentReference; data: OtpSecretDoc }> {
  const ref = getFirestore().collection(OTP_SECRETS_COLLECTION).doc(uid);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    throw new HttpsError("failed-precondition", "OTP is not set up for this account.");
  }
  const data = snapshot.data() as OtpSecretDoc;

  if (data.lockedUntil && data.lockedUntil.toMillis() > Date.now()) {
    throw new HttpsError(
      "resource-exhausted",
      "Too many incorrect attempts. Try again in a minute."
    );
  }

  const result = await verify({ secret: data.secret, token: code, epochTolerance: 30 });
  if (!result.valid) {
    const failedAttempts = (data.failedAttempts ?? 0) + 1;
    await ref.update({
      failedAttempts,
      lockedUntil:
        failedAttempts >= MAX_FAILED_ATTEMPTS
          ? Timestamp.fromMillis(Date.now() + LOCKOUT_MS)
          : null,
    });
    throw new HttpsError("permission-denied", "Incorrect code.");
  }

  await ref.update({ failedAttempts: 0, lockedUntil: null });
  return { doc: ref, data };
}

/** Step 1 of setup: generates and stores a fresh (unconfirmed) secret, returns it + a QR URI. */
export const startOtpSetup = onCall(async (request) => {
  requireAuth(request.auth?.uid);
  const uid = request.auth.uid;

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
export const confirmOtpSetup = onCall(async (request) => {
  requireAuth(request.auth?.uid);
  const uid = request.auth.uid;
  const code = requireCode(request.data);

  const { doc } = await verifyStoredOtp(uid, code);
  await doc.update({ confirmed: true });
  await mergeClaims(uid, { otpEnabled: true });
  return { success: true };
});

/** Verifies a code for the current session and stamps the auth token so Firestore rules allow reads. */
export const verifyOtp = onCall(async (request) => {
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

/** Disables OTP. Requires a currently-valid code — the same "prove the current method" rule as recovery-key/Shamir changes. */
export const disableOtp = onCall(async (request) => {
  requireAuth(request.auth?.uid);
  const uid = request.auth.uid;
  const code = requireCode(request.data);

  const { doc } = await verifyStoredOtp(uid, code);
  await doc.delete();
  await mergeClaims(uid, { otpEnabled: false, otpVerified: false, otpVerifiedAt: null });
  return { success: true };
});
