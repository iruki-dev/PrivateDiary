import { describe, expect, it } from "vitest";
import { generateMasterSeed } from "../random";
import { deriveHybridKeyPair } from "../keys";
import { combineSeedShamir, seedMatchesPublicKeys, splitSeedShamir } from "../recovery";

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

  it("reissuing (splitting the same seed again) produces entirely different shares", async () => {
    // Structural basis for "the passphrase can't know the value of
    // already-issued Shamir shares" (ARCHITECTURE.md §3.7): split() draws
    // fresh randomness every call, so reissuing via the passphrase can
    // never reproduce — or reveal — a previously-issued set of shares.
    const seed = generateMasterSeed();
    const first = await splitSeedShamir(seed, 3, 2);
    const second = await splitSeedShamir(seed, 3, 2);

    expect(first[0]).not.toEqual(second[0]);
    expect(first[1]).not.toEqual(second[1]);
    expect(first[2]).not.toEqual(second[2]);

    // Both sets still independently reconstruct the same seed.
    expect(await combineSeedShamir([first[0], first[1]])).toEqual(seed);
    expect(await combineSeedShamir([second[1], second[2]])).toEqual(seed);
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
