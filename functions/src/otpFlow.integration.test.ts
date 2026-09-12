import { generate, generateSecret } from "otplib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Full-stack integration test for functions/src/index.ts's verifyStoredOtp
 * — the two properties security-patch-v2 added to it that a pure unit test
 * (authFreshness.test.ts) can't reach, since both depend on the real
 * Callable Functions + Auth + Firestore emulator stack:
 *
 *  - M3 (replay protection): a TOTP code that already succeeded once must
 *    never succeed again for the rest of its acceptance window.
 *  - M4 (atomic lockout): the failed-attempt counter must not lose updates
 *    under concurrent wrong-code calls — the exact race a plain
 *    read-then-update was vulnerable to.
 *
 * Run via `pnpm test:integration` (wraps this in `firebase emulators:exec
 * --only auth,firestore,functions`), not plain `pnpm test` — this needs
 * live emulators, unlike authFreshness.test.ts.
 */

const PROJECT_ID = "demo-privatediary";
const REGION = "us-central1";
const AUTH_EMULATOR = "127.0.0.1:9099";
const FUNCTIONS_EMULATOR_ORIGIN = "http://127.0.0.1:5001";

process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR;
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = PROJECT_ID;

// Imported AFTER the emulator env vars are set, so the Admin SDK connects
// to the emulators instead of trying to reach real GCP.
const { initializeApp } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore, Timestamp } = await import("firebase-admin/firestore");

initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();

/** Exchanges an Admin-SDK-minted custom token for a real ID token via the Auth emulator's REST API — what a signed-in browser client would carry as its Bearer token. */
async function signInAndGetIdToken(uid: string): Promise<string> {
  await auth.createUser({ uid }).catch(() => undefined); // idempotent — fine if it already exists
  const customToken = await auth.createCustomToken(uid);
  const response = await fetch(
    `http://${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const body = (await response.json()) as { idToken?: string; error?: unknown };
  if (!body.idToken) {
    throw new Error(`signInWithCustomToken failed: ${JSON.stringify(body.error)}`);
  }
  return body.idToken;
}

/** Invokes an onCall Cloud Function exactly as the client SDK's httpsCallable does under the hood. */
async function callFunction(
  name: string,
  idToken: string,
  data: unknown
): Promise<{ status: number; result?: unknown; error?: { status?: string; message?: string } }> {
  const response = await fetch(`${FUNCTIONS_EMULATOR_ORIGIN}/${PROJECT_ID}/${REGION}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  const body = (await response.json()) as { result?: unknown; error?: { status?: string; message?: string } };
  return { status: response.status, ...body };
}

async function seedOtpSecret(
  uid: string,
  secret: string,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  await db.collection("otpSecrets").doc(uid).set({
    secret,
    confirmed: true,
    createdAt: Timestamp.now(),
    failedAttempts: 0,
    lockedUntil: null,
    ...overrides,
  });
}

// Generated fresh (not a hardcoded literal) so it's guaranteed to satisfy
// whatever minimum-entropy validation the installed @otplib/core enforces
// (20 bytes / 160 bits by default — comfortably over its 16-byte floor;
// otplib's own classic doc-comment example secret, "JBSWY3DPEHPK3PXP", is
// only 10 bytes and gets rejected by this version).
const TEST_SECRET = generateSecret();

beforeAll(async () => {
  // Confirms the emulators are actually up before running anything below —
  // a clearer failure than "fetch failed" deep inside the first test.
  const probe = await fetch(`http://${AUTH_EMULATOR}/`).catch(() => null);
  if (!probe) {
    throw new Error(
      "Auth emulator not reachable — run via `pnpm test:integration`, which starts it, not plain `pnpm test`."
    );
  }
}, 30_000);

afterAll(async () => {
  await Promise.all([
    auth.deleteUser("replay-test-user").catch(() => undefined),
    auth.deleteUser("lockout-test-user").catch(() => undefined),
  ]);
});

describe("security-patch-v2 / M3: TOTP replay protection", () => {
  it("rejects the SAME code on a second call — a code observed once must not be replayable", async () => {
    const uid = "replay-test-user";
    await seedOtpSecret(uid, TEST_SECRET);
    const idToken = await signInAndGetIdToken(uid);
    const code = await generate({ secret: TEST_SECRET });

    const first = await callFunction("verifyOtp", idToken, { code });
    expect(first.error).toBeUndefined();
    expect((first.result as { success?: boolean } | undefined)?.success).toBe(true);

    const second = await callFunction("verifyOtp", idToken, { code });
    expect(second.error?.status).toBe("PERMISSION_DENIED");

    const stored = await db.collection("otpSecrets").doc(uid).get();
    // The replayed attempt must not slip past afterTimeStep and then reset
    // failedAttempts back to 0 as if it had succeeded — it should count as
    // a genuine failure like any other wrong code.
    expect(stored.data()?.failedAttempts).toBe(1);
  }, 20_000);
});

describe("security-patch-v2 / M4: atomic brute-force lockout", () => {
  it("never loses a failed-attempt increment under concurrent wrong-code calls", async () => {
    const uid = "lockout-test-user";
    await seedOtpSecret(uid, TEST_SECRET);
    const idToken = await signInAndGetIdToken(uid);

    // 8 simultaneous wrong codes against a lockout threshold of 5
    // (MAX_FAILED_ATTEMPTS). Under the pre-fix plain read-then-update,
    // concurrent requests can all read failedAttempts=0 and each
    // independently write 1 — the counter loses updates and never
    // approaches the threshold at all. The transaction in verifyStoredOtp
    // (functions/src/index.ts) is what makes every processed attempt
    // actually count. This does NOT assert failedAttempts lands at exactly
    // 8: once it hits 5 and lockedUntil is set, any attempt whose
    // transaction reads the document AFTER that point correctly takes the
    // "already locked out" branch instead of incrementing further — that's
    // intended lockout behavior, not a lost update. What a lost update
    // WOULD look like is failedAttempts landing well below 5 (e.g. 1 or 2)
    // despite 8 wrong attempts all being rejected.
    const CONCURRENT_ATTEMPTS = 8;
    const MAX_FAILED_ATTEMPTS = 5; // must match functions/src/index.ts
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_ATTEMPTS }, () => callFunction("verifyOtp", idToken, { code: "000000" }))
    );
    for (const result of results) {
      expect(["PERMISSION_DENIED", "RESOURCE_EXHAUSTED"]).toContain(result.error?.status);
    }

    const stored = await db.collection("otpSecrets").doc(uid).get();
    expect(stored.data()?.failedAttempts).toBeGreaterThanOrEqual(MAX_FAILED_ATTEMPTS);
    expect(stored.data()?.failedAttempts).toBeLessThanOrEqual(CONCURRENT_ATTEMPTS);
    // Reaching the threshold above must have tripped the lockout.
    expect(stored.data()?.lockedUntil).not.toBeNull();
  }, 20_000);
});
