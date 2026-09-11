import { describe, expect, it } from "vitest";
import { generateMasterSeed } from "../random";
import { deriveHybridKeyPair } from "../keys";
import {
  combineSeedShamir,
  generateRecoveryKey,
  seedMatchesPublicKeys,
  splitSeedShamir,
  unwrapSeedWithRecoveryKey,
  wrapSeedWithRecoveryKey,
} from "../recovery";
import { InvalidRecoveryKeyError } from "../errors";

describe("recovery key wrap/unwrap", () => {
  it("round-trips: wrap then unwrap with the same key recovers the seed", async () => {
    const seed = generateMasterSeed();
    const key = generateRecoveryKey();

    const wrapped = await wrapSeedWithRecoveryKey(seed, key);
    const recovered = await unwrapSeedWithRecoveryKey(wrapped, key);

    expect(recovered).toEqual(seed);
  });

  it("rejects the wrong recovery key", async () => {
    const seed = generateMasterSeed();
    const wrapped = await wrapSeedWithRecoveryKey(seed, generateRecoveryKey());

    await expect(unwrapSeedWithRecoveryKey(wrapped, generateRecoveryKey())).rejects.toThrow(
      InvalidRecoveryKeyError
    );
  });

  it("generates a fresh, unpredictable key every call", () => {
    expect(generateRecoveryKey()).not.toEqual(generateRecoveryKey());
  });
});

describe("Shamir split/combine", () => {
  it("reconstructs the seed from exactly the threshold number of shares", async () => {
    const seed = generateMasterSeed();
    const shares = await splitSeedShamir(seed, 5, 3);

    const recovered = await combineSeedShamir([shares[0], shares[2], shares[4]]);

    expect(recovered).toEqual(seed);
  });

  it("silently returns garbage (not an error) for below-threshold shares — this is why seedMatchesPublicKeys must be used", async () => {
    const seed = generateMasterSeed();
    const shares = await splitSeedShamir(seed, 5, 3);

    const recovered = await combineSeedShamir([shares[0], shares[1]]); // only 2 of 3 needed

    expect(recovered).not.toEqual(seed);
  });

  it("supports different (n, k) configurations", async () => {
    const seed = generateMasterSeed();
    const shares = await splitSeedShamir(seed, 3, 2);
    expect(shares).toHaveLength(3);

    const recovered = await combineSeedShamir([shares[1], shares[2]]);
    expect(recovered).toEqual(seed);
  });
});

describe("seedMatchesPublicKeys", () => {
  it("returns true for the correct seed", () => {
    const seed = generateMasterSeed();
    const { publicKeys } = deriveHybridKeyPair(seed);
    expect(seedMatchesPublicKeys(seed, publicKeys)).toBe(true);
  });

  it("returns false for an unrelated seed", () => {
    const { publicKeys } = deriveHybridKeyPair(generateMasterSeed());
    expect(seedMatchesPublicKeys(generateMasterSeed(), publicKeys)).toBe(false);
  });

  it("catches a garbage reconstruction from insufficient Shamir shares", async () => {
    const seed = generateMasterSeed();
    const { publicKeys } = deriveHybridKeyPair(seed);
    const shares = await splitSeedShamir(seed, 5, 3);

    const garbage = await combineSeedShamir([shares[0], shares[1]]);

    expect(seedMatchesPublicKeys(garbage, publicKeys)).toBe(false);
  });
});
