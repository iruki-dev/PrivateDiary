import { readFileSync } from "node:fs";
import {
  addDoc,
  collection,
  deleteDoc,
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
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

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

describe("users/{uid}.recovery", () => {
  it("allows creating with recovery: none", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      setDoc(doc(alice, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        recovery: { type: "none" },
        createdAt: new Date(),
      })
    );
  });

  it("allows setting up recovery-key (only `recovery` changes)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        recovery: { type: "none" },
        createdAt: new Date(2024, 0, 1),
      });
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(alice, "users/alice"), {
        recovery: { type: "recovery-key", wrappedSeed: { ciphertext: "ct", iv: "iv" } },
      })
    );
  });

  it("allows setting up Shamir recovery", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        recovery: { type: "none" },
        createdAt: new Date(2024, 0, 1),
      });
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(alice, "users/alice"), { recovery: { type: "shamir", n: 5, k: 3 } })
    );
  });

  it("rejects a recovery-key entry missing the wrapped seed", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(alice, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        recovery: { type: "recovery-key" },
        createdAt: new Date(),
      })
    );
  });

  it("rejects a shamir entry with a non-integer k", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(alice, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        recovery: { type: "shamir", n: 5, k: "three" },
        createdAt: new Date(),
      })
    );
  });

  it("rejects an unrecognized recovery type", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(alice, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        recovery: { type: "sms" },
        createdAt: new Date(),
      })
    );
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
