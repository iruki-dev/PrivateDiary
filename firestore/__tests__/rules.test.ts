import { readFileSync } from "node:fs";
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Runs against the real Firestore emulator with firestore.rules loaded —
 * run via `pnpm test:rules` (wraps this in `firebase emulators:exec`), not
 * plain `pnpm test`. Verifies ARCHITECTURE.md §5/Phase 3's requirements:
 * cross-user reads denied, entries are append-only, and the
 * isKeyRotationRequest() gap-fill (see firestore.rules) behaves as intended.
 */

// "demo-*" per Firebase's own recommendation, so this can never accidentally
// touch a real project even if emulator env vars are misconfigured.
const PROJECT_ID = "demo-privatediary";

let testEnv: RulesTestEnvironment;

function validPublicKeys() {
  return { x25519: "x25519-pub-placeholder", mlkem768: "mlkem768-pub-placeholder" };
}

function validWrappedSeed(tag = "a") {
  return {
    ciphertext: `ciphertext-${tag}`,
    iv: `iv-${tag}`,
    salt: `salt-${tag}`,
    kdf: "pbkdf2",
    kdfParams: { iterations: 600_000, hash: "SHA-256" },
  };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe("users/{uid}", () => {
  it("lets a user create their own key-issuance document", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      setDoc(doc(alice, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        createdAt: new Date(),
      })
    );
  });

  it("rejects creating a document for a different uid", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(alice, "users/bob"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        createdAt: new Date(),
      })
    );
  });

  it("rejects a document with unexpected top-level fields", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(alice, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        createdAt: new Date(),
        privateKey: "should-never-be-here",
      })
    );
  });

  it("lets the owner read their own document, denies everyone else", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        createdAt: new Date(),
      });
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    const bob = testEnv.authenticatedContext("bob").firestore() as unknown as Firestore;
    const anon = testEnv.unauthenticatedContext().firestore() as unknown as Firestore;

    await assertSucceeds(getDoc(doc(alice, "users/alice")));
    await assertFails(getDoc(doc(bob, "users/alice")));
    await assertFails(getDoc(doc(anon, "users/alice")));
  });

  it("allows a passphrase-change update (only wrappedSeed changes)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed("old"),
        createdAt: new Date(2024, 0, 1),
      });
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(alice, "users/alice"), { wrappedSeed: validWrappedSeed("new") })
    );
  });

  it("allows a full reset (publicKeys + wrappedSeed change together, createdAt untouched)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed("old"),
        createdAt: new Date(2024, 0, 1),
      });
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(alice, "users/alice"), {
        publicKeys: { x25519: "new-x25519", mlkem768: "new-mlkem768" },
        wrappedSeed: validWrappedSeed("reset"),
      })
    );
  });

  it("rejects an update that changes createdAt", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed("old"),
        createdAt: new Date(2024, 0, 1),
      });
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(alice, "users/alice"), {
        wrappedSeed: validWrappedSeed("new"),
        createdAt: new Date(2025, 0, 1),
      })
    );
  });

  it("rejects another user updating this document", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed("old"),
        createdAt: new Date(2024, 0, 1),
      });
    });

    const bob = testEnv.authenticatedContext("bob").firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(bob, "users/alice"), { wrappedSeed: validWrappedSeed("hijacked") })
    );
  });

  it("never allows delete", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        createdAt: new Date(),
      });
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(deleteDoc(doc(alice, "users/alice")));
  });
});

describe("users/{uid}.decryptionMethods", () => {
  it("allows creating with an empty decryptionMethods map", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      setDoc(doc(alice, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        decryptionMethods: {},
        createdAt: new Date(),
      })
    );
  });

  it("allows setting up Shamir via a dotted-path update", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        decryptionMethods: {},
        createdAt: new Date(2024, 0, 1),
      });
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(alice, "users/alice"), { "decryptionMethods.shamir": { n: 5, k: 3 } })
    );

    const snapshot = await getDoc(doc(alice, "users/alice"));
    expect(snapshot.data()?.decryptionMethods).toEqual({ shamir: { n: 5, k: 3 } });
  });

  it("rejects any update that leaves a legacy recoveryKey field in the merged document", async () => {
    // Regression: accounts that enabled the now-removed recovery key
    // before ARCHITECTURE.md §3.7 rev. 3 still have this field sitting in
    // Firestore. Rules validate the FULL merged document on every write, so
    // a plain wrappedSeed-only update (mimicking a passphrase change) would
    // fail as long as that legacy field is present — this is exactly what
    // lib/firebase/users.ts's legacyRecoveryKeyCleanup exists to prevent.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed("old"),
        decryptionMethods: { recoveryKey: { wrappedSeed: { ciphertext: "ct", iv: "iv" } } },
        createdAt: new Date(2024, 0, 1),
      });
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(updateDoc(doc(alice, "users/alice"), { wrappedSeed: validWrappedSeed("new") }));
  });

  it("clearing the legacy recoveryKey field alongside another update succeeds", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed("old"),
        decryptionMethods: { recoveryKey: { wrappedSeed: { ciphertext: "ct", iv: "iv" } } },
        createdAt: new Date(2024, 0, 1),
      });
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(alice, "users/alice"), {
        wrappedSeed: validWrappedSeed("new"),
        "decryptionMethods.recoveryKey": deleteField(),
      })
    );

    const snapshot = await getDoc(doc(alice, "users/alice"));
    expect(snapshot.data()?.decryptionMethods).toEqual({});
  });

  it("allows reissuing Shamir (overwriting the existing n/k shape)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        decryptionMethods: { shamir: { n: 5, k: 3 } },
        createdAt: new Date(2024, 0, 1),
      });
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(alice, "users/alice"), { "decryptionMethods.shamir": { n: 3, k: 2 } })
    );

    const snapshot = await getDoc(doc(alice, "users/alice"));
    expect(snapshot.data()?.decryptionMethods).toEqual({ shamir: { n: 3, k: 2 } });
  });

  it("allows disabling Shamir entirely", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        decryptionMethods: { shamir: { n: 5, k: 3 } },
        createdAt: new Date(2024, 0, 1),
      });
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(alice, "users/alice"), { "decryptionMethods.shamir": deleteField() })
    );

    const snapshot = await getDoc(doc(alice, "users/alice"));
    expect(snapshot.data()?.decryptionMethods).toEqual({});
  });

  it("allows resetting the passphrase (wrappedSeed only) regardless of what proved it — rules can't tell passphrase-proof from Shamir-proof, by design", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed("old"),
        decryptionMethods: { shamir: { n: 5, k: 3 } },
        createdAt: new Date(2024, 0, 1),
      });
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(alice, "users/alice"), { wrappedSeed: validWrappedSeed("new") })
    );
  });

  it("rejects a shamir entry with a non-integer k", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(alice, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        decryptionMethods: { shamir: { n: 5, k: "three" } },
        createdAt: new Date(),
      })
    );
  });

  it("rejects an unrecognized key under decryptionMethods", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(alice, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        decryptionMethods: { sms: true },
        createdAt: new Date(),
      })
    );
  });
});

describe("otpSatisfied() gate (functions/src/index.ts sets these claims — simulated here directly)", () => {
  async function seedUserAndEntry() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        createdAt: new Date(),
      });
      await setDoc(doc(db, "entries/entry1"), {
        uid: "alice",
        entrySeq: 1,
        ciphertext: "ct",
        aad: { uid: "alice", entrySeq: 1, createdAt: "2026-01-01T00:00:00.000Z" },
        createdAt: new Date(),
      });
    });
  }

  it("allows entries reads when the account has no otpEnabled claim at all", async () => {
    await seedUserAndEntry();
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(doc(alice, "entries/entry1")));
  });

  it("denies entries reads when otpEnabled is true but otpVerified is missing/false", async () => {
    await seedUserAndEntry();
    const alice = testEnv
      .authenticatedContext("alice", { otpEnabled: true })
      .firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(alice, "entries/entry1")));
  });

  it("allows entries reads when otpEnabled and otpVerified are both true with a fresh otpVerifiedAt", async () => {
    await seedUserAndEntry();
    const alice = testEnv
      .authenticatedContext("alice", {
        otpEnabled: true,
        otpVerified: true,
        otpVerifiedAt: Date.now(),
      })
      .firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(doc(alice, "entries/entry1")));
  });

  it("denies entries reads once otpVerifiedAt is older than the 12h session window", async () => {
    await seedUserAndEntry();
    const alice = testEnv
      .authenticatedContext("alice", {
        otpEnabled: true,
        otpVerified: true,
        otpVerifiedAt: Date.now() - 13 * 60 * 60 * 1000,
      })
      .firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(alice, "entries/entry1")));
  });

  it("users/{uid} reads are NEVER gated by OTP — needed to fetch publicKeys for writing regardless of unlock state", async () => {
    await seedUserAndEntry();
    const alice = testEnv
      .authenticatedContext("alice", { otpEnabled: true })
      .firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(doc(alice, "users/alice")));
  });

  it("never allows any client to read otpSecrets, even the account owner", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "otpSecrets/alice"), { secret: "JBSWY3DPEHPK3PXP", confirmed: true });
    });
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(alice, "otpSecrets/alice")));
  });
});

describe("entries/{entryId}", () => {
  it("lets the owner create an entry with an integer entrySeq", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      addDoc(collection(alice, "entries"), {
        uid: "alice",
        entrySeq: 1,
        ciphertext: "ct",
        iv: "iv",
        wrappedContentKey: "wck",
        wrappedContentKeyIv: "wckiv",
        kemCiphertext: "kemct",
        ephemeralX25519PublicKey: "eph",
        aad: { uid: "alice", entrySeq: 1, createdAt: "2026-01-01T00:00:00.000Z" },
        createdAt: new Date(),
      })
    );
  });

  it("rejects creating an entry under someone else's uid", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      addDoc(collection(alice, "entries"), {
        uid: "bob",
        entrySeq: 1,
        ciphertext: "ct",
        aad: { uid: "bob", entrySeq: 1, createdAt: "2026-01-01T00:00:00.000Z" },
        createdAt: new Date(),
      })
    );
  });

  it("rejects an entry with a non-integer entrySeq", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      addDoc(collection(alice, "entries"), {
        uid: "alice",
        entrySeq: "1",
        ciphertext: "ct",
        aad: { uid: "alice", entrySeq: 1, createdAt: "2026-01-01T00:00:00.000Z" },
        createdAt: new Date(),
      })
    );
  });

  it("lets the owner read their own entry, denies other users", async () => {
    let entryId = "";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      const ref = await addDoc(collection(db, "entries"), {
        uid: "alice",
        entrySeq: 1,
        ciphertext: "ct",
        aad: { uid: "alice", entrySeq: 1, createdAt: "2026-01-01T00:00:00.000Z" },
        createdAt: new Date(),
      });
      entryId = ref.id;
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    const bob = testEnv.authenticatedContext("bob").firestore() as unknown as Firestore;

    await assertSucceeds(getDoc(doc(alice, "entries", entryId)));
    await assertFails(getDoc(doc(bob, "entries", entryId)));
  });

  it("denies listing another user's entries", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await addDoc(collection(db, "entries"), {
        uid: "alice",
        entrySeq: 1,
        ciphertext: "ct",
        aad: { uid: "alice", entrySeq: 1, createdAt: "2026-01-01T00:00:00.000Z" },
        createdAt: new Date(),
      });
    });

    const bob = testEnv.authenticatedContext("bob").firestore() as unknown as Firestore;
    // Firestore evaluates per-document `read` rules against every doc a
    // query would match; since none belong to bob, the query itself is
    // denied rather than silently returning zero results.
    await assertFails(getDocs(collection(bob, "entries")));
  });

  it("never allows update or delete, even by the owner", async () => {
    let entryId = "";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      const ref = await addDoc(collection(db, "entries"), {
        uid: "alice",
        entrySeq: 1,
        ciphertext: "ct",
        aad: { uid: "alice", entrySeq: 1, createdAt: "2026-01-01T00:00:00.000Z" },
        createdAt: new Date(),
      });
      entryId = ref.id;
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(updateDoc(doc(alice, "entries", entryId), { ciphertext: "tampered" }));
    await assertFails(deleteDoc(doc(alice, "entries", entryId)));
  });
});
