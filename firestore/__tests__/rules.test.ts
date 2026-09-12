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

// Mirrors lib/crypto/codec.ts's publicKeysToStorage() exactly — x25519 is a
// JWK-shaped map, not a bare string. firestore.rules validates that shape
// now, so a looser placeholder here would test something the app never writes.
// security-patch-v2 / H2: firestore.rules' isB64/isB64Url now check the
// actual base64(url) alphabet, not just length — every placeholder string
// below must therefore be real base64(url) characters only (letters,
// digits, and — only for the x25519.x field, which is base64url — `-`/`_`)
// so tests asserting success don't spuriously start failing on charset
// grounds unrelated to what they're actually testing.
function validPublicKeys() {
  return {
    x25519: { kty: "OKP", crv: "X25519", x: "x25519PubPlaceholder" },
    mlkem768: "mlkem768PubPlaceholder",
  };
}

function validWrappedSeed(tag = "a") {
  return {
    ciphertext: `ciphertext${tag}`,
    iv: `iv${tag}`,
    salt: `salt${tag}`,
    kdf: "pbkdf2",
    kdfParams: { iterations: 600_000, hash: "SHA-256" },
  };
}

function validShamir(n: number, k: number, tag = "a") {
  return {
    n,
    k,
    wrappedSeed: { ciphertext: `shamirCt${tag}`, iv: `shamirIv${tag}` },
    otpBypassVerifier: `shamirOtpBypass${tag}`,
  };
}

/**
 * security-patch-v2 / C1: every legitimate self-service credential
 * mutation on a NON-OTP account (passphrase change, Shamir setup/reissue/
 * disable, full reset) now additionally requires firestore.rules'
 * isRecentAuth() — see that function's doc comment. A plain
 * `authenticatedContext(uid)` carries no `auth_time` claim at all, which
 * correctly reads as "not recently authenticated", so every test that
 * exercises one of those legitimate flows needs this instead.
 */
function recentlyAuthenticatedContext(uid: string) {
  return testEnv.authenticatedContext(uid, { auth_time: Math.floor(Date.now() / 1000) });
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

    const alice = recentlyAuthenticatedContext("alice").firestore() as unknown as Firestore;
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

    const alice = recentlyAuthenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(alice, "users/alice"), {
        publicKeys: {
          x25519: { kty: "OKP", crv: "X25519", x: "newX25519" },
          mlkem768: "newMlkem768",
        },
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

    const alice = recentlyAuthenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(alice, "users/alice"), { "decryptionMethods.shamir": validShamir(5, 3) })
    );

    const snapshot = await getDoc(doc(alice, "users/alice"));
    expect(snapshot.data()?.decryptionMethods).toEqual({ shamir: validShamir(5, 3) });
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

    const alice = recentlyAuthenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(alice, "users/alice"), {
        wrappedSeed: validWrappedSeed("new"),
        "decryptionMethods.recoveryKey": deleteField(),
      })
    );

    const snapshot = await getDoc(doc(alice, "users/alice"));
    expect(snapshot.data()?.decryptionMethods).toEqual({});
  });

  it("allows reissuing Shamir (overwriting the existing n/k/wrappedSeed shape)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        decryptionMethods: { shamir: validShamir(5, 3, "gen1") },
        createdAt: new Date(2024, 0, 1),
      });
    });

    const alice = recentlyAuthenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(alice, "users/alice"), { "decryptionMethods.shamir": validShamir(3, 2, "gen2") })
    );

    const snapshot = await getDoc(doc(alice, "users/alice"));
    // The old generation's wrappedSeed ciphertext is gone entirely, not
    // merged with the new one — this replace-not-merge semantics at the
    // rules/Firestore layer is what lib/crypto/recovery.ts's reissue
    // relies on to actually invalidate previously-issued shares.
    expect(snapshot.data()?.decryptionMethods).toEqual({ shamir: validShamir(3, 2, "gen2") });
  });

  it("allows disabling Shamir entirely", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        decryptionMethods: { shamir: validShamir(5, 3) },
        createdAt: new Date(2024, 0, 1),
      });
    });

    const alice = recentlyAuthenticatedContext("alice").firestore() as unknown as Firestore;
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
        decryptionMethods: { shamir: validShamir(5, 3) },
        createdAt: new Date(2024, 0, 1),
      });
    });

    const alice = recentlyAuthenticatedContext("alice").firestore() as unknown as Firestore;
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
        decryptionMethods: { shamir: { n: 5, k: "three", wrappedSeed: { ciphertext: "ct", iv: "iv" } } },
        createdAt: new Date(),
      })
    );
  });

  it("rejects a shamir entry missing the wrappedSeed sub-object", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(alice, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        decryptionMethods: { shamir: { n: 5, k: 3 } },
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

  it("allows a shamir entry without otpBypassVerifier — accounts that reissued before it existed", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      setDoc(doc(alice, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        decryptionMethods: { shamir: { n: 5, k: 3, wrappedSeed: { ciphertext: "ct", iv: "iv" } } },
        createdAt: new Date(),
      })
    );
  });

  it("rejects a shamir entry with a non-string otpBypassVerifier", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(alice, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        decryptionMethods: {
          shamir: {
            n: 5,
            k: 3,
            wrappedSeed: { ciphertext: "ct", iv: "iv" },
            otpBypassVerifier: 12345,
          },
        },
        createdAt: new Date(),
      })
    );
  });
});

describe("users/{uid}.preferences", () => {
  it("allows setting preferences via a dotted-path update", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        createdAt: new Date(2024, 0, 1),
      });
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(alice, "users/alice"), { "preferences.privateWritingMode": true })
    );
  });

  it("allows setting both preference fields at once", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        createdAt: new Date(2024, 0, 1),
      });
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(alice, "users/alice"), {
        preferences: { privateWritingMode: true, privateWritingPeekAllowed: false },
      })
    );
  });

  it("rejects a non-boolean preference value", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        createdAt: new Date(2024, 0, 1),
      });
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(alice, "users/alice"), { "preferences.privateWritingMode": "yes" })
    );
  });

  it("rejects an unexpected key under preferences", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        createdAt: new Date(2024, 0, 1),
      });
    });

    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(alice, "users/alice"), { "preferences.somethingElse": true })
    );
  });

  it("rejects another user setting this account's preferences", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        createdAt: new Date(2024, 0, 1),
      });
    });

    const bob = testEnv.authenticatedContext("bob").firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(bob, "users/alice"), { "preferences.privateWritingMode": true })
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

  it("rejects an entry whose ciphertext exceeds the 500,000-char size cap", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      addDoc(collection(alice, "entries"), {
        uid: "alice",
        entrySeq: 1,
        ciphertext: "x".repeat(500_001),
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

  it("allows an entry whose ciphertext is right at the 500,000-char size cap", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      addDoc(collection(alice, "entries"), {
        uid: "alice",
        entrySeq: 1,
        ciphertext: "x".repeat(500_000),
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

/**
 * Regression tests for the authorization holes found in the security
 * review. Each one FAILED (i.e. the attack succeeded) against the previous
 * version of firestore.rules.
 *
 * The threat model throughout: an attacker holding nothing but a valid
 * Firebase session for the victim — a stolen/hijacked ID token — and none
 * of the actual credentials (no passphrase, no Shamir shares, no TOTP
 * device). `otpEnabled: true` without `otpVerified` is exactly that caller.
 */
describe("hardening: a session-only attacker on an OTP-enabled account", () => {
  function seedUserDoc(extra: Record<string, unknown> = {}) {
    return testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed("real"),
        createdAt: new Date(2024, 0, 1),
        ...extra,
      });
    });
  }

  /** Signed in, OTP enabled on the account, OTP never verified this session. */
  function attacker() {
    return testEnv
      .authenticatedContext("alice", { otpEnabled: true })
      .firestore() as unknown as Firestore;
  }

  /** Same account after a real TOTP code (or a real Shamir bypass proof). */
  function verified() {
    return testEnv
      .authenticatedContext("alice", {
        otpEnabled: true,
        otpVerified: true,
        otpVerifiedAt: Date.now(),
      })
      .firestore() as unknown as Firestore;
  }

  it("cannot plant an otpBypassVerifier it knows the preimage of (OTP gate bypass)", async () => {
    await seedUserDoc({ decryptionMethods: { shamir: validShamir(5, 3, "victim") } });
    await assertFails(
      updateDoc(doc(attacker(), "users/alice"), {
        "decryptionMethods.shamir": validShamir(2, 2, "attackerChosen"),
      })
    );
  });

  it("cannot destroy the account by overwriting wrappedSeed + publicKeys", async () => {
    await seedUserDoc();
    await assertFails(
      updateDoc(doc(attacker(), "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed("garbage"),
      })
    );
  });

  it("cannot strip the Shamir recovery credential off the account", async () => {
    await seedUserDoc({ decryptionMethods: { shamir: validShamir(5, 3) } });
    await assertFails(
      updateDoc(doc(attacker(), "users/alice"), { "decryptionMethods.shamir": deleteField() })
    );
  });

  it("cannot downgrade the PBKDF2 iteration count below the lib/crypto floor", async () => {
    await seedUserDoc();
    await assertFails(
      updateDoc(doc(verified(), "users/alice"), {
        wrappedSeed: { ...validWrappedSeed("weak"), kdfParams: { iterations: 1, hash: "SHA-256" } },
      })
    );
  });

  it("cannot rewind lastEntrySeq to re-issue an already-used sequence number", async () => {
    await seedUserDoc({ lastEntrySeq: 7 });
    await assertFails(updateDoc(doc(attacker(), "users/alice"), { lastEntrySeq: 3 }));
  });

  // The gate must not swallow the two things that legitimately happen
  // without it — otherwise writing a diary entry (ARCHITECTURE.md §3.2
  // rule 5) would start depending on a gate that is meant to be read-only.
  it("CAN still bump lastEntrySeq — the write path must work without OTP", async () => {
    await seedUserDoc({ lastEntrySeq: 7 });
    await assertSucceeds(updateDoc(doc(attacker(), "users/alice"), { lastEntrySeq: 8 }));
  });

  it("CAN still change display preferences — they carry no security weight", async () => {
    await seedUserDoc();
    await assertSucceeds(
      updateDoc(doc(attacker(), "users/alice"), { "preferences.privateWritingMode": true })
    );
  });

  it("the real Shamir recovery path still works once the bypass has verified", async () => {
    // Lost passphrase AND lost the OTP device: verifyShamirOtpBypass sets
    // otpVerified from genuine shares first, and only then does the client
    // rewrite wrappedSeed. That ordering has to remain possible.
    await seedUserDoc({ decryptionMethods: { shamir: validShamir(5, 3) } });
    await assertSucceeds(
      updateDoc(doc(verified(), "users/alice"), { wrappedSeed: validWrappedSeed("recovered") })
    );
  });
});

describe("hardening: entries/{entryId} shape validation", () => {
  function validEntry(overrides: Record<string, unknown> = {}) {
    return {
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
      ...overrides,
    };
  }

  it("accepts a well-formed entry", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(addDoc(collection(alice, "entries"), validEntry()));
  });

  it("rejects a half-formed junk document (entries can never be deleted once written)", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      addDoc(collection(alice, "entries"), { uid: "alice", entrySeq: 1, ciphertext: "junk" })
    );
  });

  it("rejects an aad.uid that disagrees with the document's own uid", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      addDoc(
        collection(alice, "entries"),
        validEntry({ aad: { uid: "bob", entrySeq: 1, createdAt: "2026-01-01T00:00:00.000Z" } })
      )
    );
  });

  it("rejects an aad.entrySeq that disagrees with the indexed entrySeq it is ordered by", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      addDoc(
        collection(alice, "entries"),
        validEntry({ aad: { uid: "alice", entrySeq: 99, createdAt: "2026-01-01T00:00:00.000Z" } })
      )
    );
  });

  it("rejects a non-positive entrySeq", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      addDoc(
        collection(alice, "entries"),
        validEntry({ entrySeq: 0, aad: { uid: "alice", entrySeq: 0, createdAt: "2026-01-01T00:00:00.000Z" } })
      )
    );
  });

  it("rejects an unknown extra field", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(addDoc(collection(alice, "entries"), validEntry({ plaintext: "oops" })));
  });
});

describe("security-patch-v2 / C1: credentialMutationAllowed() on NON-OTP accounts", () => {
  function seedUserDoc(extra: Record<string, unknown> = {}) {
    return testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed("real"),
        createdAt: new Date(2024, 0, 1),
        ...extra,
      });
    });
  }

  const NOW_S = () => Math.floor(Date.now() / 1000);
  /** No auth_time claim at all — the realistic shape of a long-lived, silently-refreshed session token (e.g. a stolen one). */
  const staleSession = () =>
    testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
  const sixHoursStaleSession = () =>
    testEnv
      .authenticatedContext("alice", { auth_time: NOW_S() - 6 * 60 * 60 })
      .firestore() as unknown as Firestore;

  it("cannot overwrite wrappedSeed + publicKeys without a recent sign-in (the C1 hole this closes)", async () => {
    await seedUserDoc();
    await assertFails(
      updateDoc(doc(staleSession(), "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed("attacker"),
      })
    );
  });

  it("cannot overwrite decryptionMethods.shamir without a recent sign-in", async () => {
    await seedUserDoc({ decryptionMethods: { shamir: validShamir(5, 3, "victim") } });
    await assertFails(
      updateDoc(doc(staleSession(), "users/alice"), {
        "decryptionMethods.shamir": validShamir(2, 2, "attackerChosen"),
      })
    );
  });

  it("cannot strip the Shamir recovery credential without a recent sign-in", async () => {
    await seedUserDoc({ decryptionMethods: { shamir: validShamir(5, 3) } });
    await assertFails(
      updateDoc(doc(staleSession(), "users/alice"), { "decryptionMethods.shamir": deleteField() })
    );
  });

  it("an hours-old auth_time is still treated as stale, not just a totally absent claim", async () => {
    await seedUserDoc();
    await assertFails(
      updateDoc(doc(sixHoursStaleSession(), "users/alice"), { wrappedSeed: validWrappedSeed("attacker") })
    );
  });

  it("a genuinely recent sign-in CAN still change the passphrase (the legitimate flow keeps working)", async () => {
    await seedUserDoc();
    await assertSucceeds(
      updateDoc(doc(recentlyAuthenticatedContext("alice").firestore() as unknown as Firestore, "users/alice"), {
        wrappedSeed: validWrappedSeed("new"),
      })
    );
  });

  it("preferences/lastEntrySeq stay ungated regardless of auth_time — the write path must not require reauth", async () => {
    await seedUserDoc({ lastEntrySeq: 3 });
    await assertSucceeds(updateDoc(doc(staleSession(), "users/alice"), { lastEntrySeq: 4 }));
    await assertSucceeds(
      updateDoc(doc(staleSession(), "users/alice"), { "preferences.privateWritingMode": true })
    );
  });

  it("does not change OTP-enabled accounts: a fresh sign-in alone still does not bypass otpSatisfied()", async () => {
    await seedUserDoc();
    const otpAttacker = testEnv
      .authenticatedContext("alice", { otpEnabled: true, auth_time: NOW_S() })
      .firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(otpAttacker, "users/alice"), { wrappedSeed: validWrappedSeed("attacker") })
    );
  });

  it("does not change OTP-enabled accounts: an OTP-verified session with a stale auth_time can still rotate the passphrase", async () => {
    await seedUserDoc();
    const otpVerified = testEnv
      .authenticatedContext("alice", {
        otpEnabled: true,
        otpVerified: true,
        otpVerifiedAt: Date.now(),
        auth_time: NOW_S() - 6 * 60 * 60,
      })
      .firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(otpVerified, "users/alice"), { wrappedSeed: validWrappedSeed("new") })
    );
  });
});

describe("security-patch-v2 / H1: entrySeq / lastEntrySeq upper bound", () => {
  function validEntry(overrides: Record<string, unknown> = {}) {
    return {
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
      ...overrides,
    };
  }

  it("rejects an entry with an absurdly large entrySeq — the unbounded-DoS-loop hole this closes", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      addDoc(
        collection(alice, "entries"),
        validEntry({
          entrySeq: 1_000_000_000,
          aad: { uid: "alice", entrySeq: 1_000_000_000, createdAt: "2026-01-01T00:00:00.000Z" },
        })
      )
    );
  });

  it("accepts an entrySeq right at the cap", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      addDoc(
        collection(alice, "entries"),
        validEntry({
          entrySeq: 1_000_000,
          aad: { uid: "alice", entrySeq: 1_000_000, createdAt: "2026-01-01T00:00:00.000Z" },
        })
      )
    );
  });

  it("rejects lastEntrySeq set past the same cap", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(alice, "users/alice"), {
        publicKeys: validPublicKeys(),
        wrappedSeed: validWrappedSeed(),
        lastEntrySeq: 9_000_000_000,
        createdAt: new Date(),
      })
    );
  });
});

describe("security-patch-v2 / H2: isB64 / isB64Url actually check the alphabet", () => {
  it("rejects non-base64 characters in an entry's ciphertext instead of silently accepting junk", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      addDoc(collection(alice, "entries"), {
        uid: "alice",
        entrySeq: 1,
        ciphertext: "not base64 at all!!!",
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

  it("still accepts real base64 with + / and = padding in an entry field", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      addDoc(collection(alice, "entries"), {
        uid: "alice",
        entrySeq: 1,
        ciphertext: "SGVsbG8rL3dvcmxkPT0=",
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

  it("rejects a users/{uid} document whose mlkem768 key contains characters outside the base64 alphabet", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(alice, "users/alice"), {
        publicKeys: {
          x25519: { kty: "OKP", crv: "X25519", x: "x25519PubPlaceholder" },
          mlkem768: "not valid base64!!!",
        },
        wrappedSeed: validWrappedSeed(),
        createdAt: new Date(),
      })
    );
  });

  it("accepts a real base64url x25519.x value (- and _, no padding) — the field lib/crypto's bytesToBase64Url actually produces", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertSucceeds(
      setDoc(doc(alice, "users/alice"), {
        publicKeys: {
          x25519: { kty: "OKP", crv: "X25519", x: "abc-DEF_123" },
          mlkem768: validPublicKeys().mlkem768,
        },
        wrappedSeed: validWrappedSeed(),
        createdAt: new Date(),
      })
    );
  });

  it("rejects a base64url x25519.x value that still contains standard-alphabet + or / characters", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(alice, "users/alice"), {
        publicKeys: {
          x25519: { kty: "OKP", crv: "X25519", x: "abc+DEF/123" },
          mlkem768: validPublicKeys().mlkem768,
        },
        wrappedSeed: validWrappedSeed(),
        createdAt: new Date(),
      })
    );
  });
});
