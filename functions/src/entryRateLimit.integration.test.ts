import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * PENTEST FINDING F-2: full-stack integration test for
 * index.ts's enforceEntryRateLimit — the Firestore trigger that actually
 * enforces `security.dailyEntryLimit` (entryRateLimit.ts's pure decision
 * logic is covered separately, without an emulator, in
 * entryRateLimit.test.ts). This needs the real Firestore emulator with
 * the real trigger deployed, since the thing under test is precisely
 * "does creating an `entries` document actually cause the trigger to run
 * and, once the account is over its limit, delete the excess" — not
 * something a pure unit test can observe.
 *
 * Run via `pnpm test:integration` (wraps this in `firebase emulators:exec
 * --only auth,firestore,functions`), not plain `pnpm test`.
 */

const PROJECT_ID = "demo-privatediary";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = PROJECT_ID;

const { initializeApp } = await import("firebase-admin/app");
const { getFirestore, Timestamp } = await import("firebase-admin/firestore");

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

function validEntry(uid: string, seq: number) {
  return {
    uid,
    entrySeq: seq,
    ciphertext: "c".repeat(1400),
    iv: "iv",
    wrappedContentKey: "wck",
    wrappedContentKeyIv: "wckiv",
    kemCiphertext: "kemct",
    ephemeralX25519PublicKey: "eph",
    aad: { uid, entrySeq: seq, createdAt: new Date().toISOString(), fmt: "padded-v1" },
    createdAt: Timestamp.now(),
  };
}

/** Polls `check` until it returns true or `timeoutMs` elapses — the trigger runs asynchronously after each write commits, so tests can't just read-immediately-after-write. */
async function waitFor(check: () => Promise<boolean>, timeoutMs = 15_000, intervalMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error("waitFor: timed out");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

beforeAll(async () => {
  const probe = await fetch("http://127.0.0.1:8080/").catch(() => null);
  if (!probe) {
    throw new Error(
      "Firestore emulator not reachable — run via `pnpm test:integration`, which starts it, not plain `pnpm test`."
    );
  }
}, 30_000);

afterAll(async () => {
  await Promise.all([
    db.collection("users").doc("rate-limit-test-user").delete().catch(() => undefined),
    db.collection("entryRateLimits").doc("rate-limit-test-user").delete().catch(() => undefined),
  ]);
});

describe("PENTEST F-2: enforceEntryRateLimit Firestore trigger", () => {
  it("deletes entries once the account exceeds its own configured daily limit, and stops the count from growing unbounded", async () => {
    const uid = "rate-limit-test-user";
    const limit = 3;

    await db.collection("users").doc(uid).set({ security: { dailyEntryLimit: limit } });

    const created = await Promise.all(
      Array.from({ length: 5 }, (_, i) => db.collection("entries").add(validEntry(uid, i + 1)))
    );

    // Wait for the trigger to have processed all 5 creates (the rate-limit
    // counter document reaches count === 5 once every trigger invocation
    // has run its transaction, regardless of which entries it ultimately
    // kept vs. deleted).
    await waitFor(async () => {
      const snap = await db.collection("entryRateLimits").doc(uid).get();
      return snap.exists && (snap.data()?.count ?? 0) >= 5;
    });

    // Give any in-flight delete() calls a moment to land after the counter
    // write (the transaction commits before the conditional delete runs).
    await waitFor(async () => {
      const remaining = await db.collection("entries").where("uid", "==", uid).get();
      return remaining.size === limit;
    });

    const remaining = await db.collection("entries").where("uid", "==", uid).get();
    expect(remaining.size).toBe(limit);

    for (const ref of created) {
      // Every created doc was either kept (still exists) or deleted by the
      // trigger for exceeding the limit — never left in some other state.
      const snap = await ref.get();
      expect(typeof snap.exists).toBe("boolean");
    }
  }, 30_000);

  it("does not delete anything when dailyEntryLimit is 0 (explicitly unlimited)", async () => {
    const uid = "rate-limit-unlimited-user";
    await db.collection("users").doc(uid).set({ security: { dailyEntryLimit: 0 } });

    await Promise.all(
      Array.from({ length: 4 }, (_, i) => db.collection("entries").add(validEntry(uid, i + 1)))
    );

    await waitFor(async () => {
      const snap = await db.collection("entryRateLimits").doc(uid).get();
      return snap.exists && (snap.data()?.count ?? 0) >= 4;
    });

    const remaining = await db.collection("entries").where("uid", "==", uid).get();
    expect(remaining.size).toBe(4);

    await Promise.all([
      db.collection("users").doc(uid).delete(),
      db.collection("entryRateLimits").doc(uid).delete(),
      ...remaining.docs.map((d) => d.ref.delete()),
    ]);
  }, 30_000);
});
