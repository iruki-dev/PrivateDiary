import { describe, expect, it } from "vitest";
import { generateMasterSeed } from "../random";
import { combineSeedShamir, splitSeedShamir } from "../recovery";
import { InvalidShamirSharesError } from "../errors";

describe("Shamir split/combine", () => {
  it("reconstructs the seed from exactly the threshold number of shares", async () => {
    const seed = generateMasterSeed();
    const { shares, wrappedSeed } = await splitSeedShamir(seed, 5, 3);

    const recovered = await combineSeedShamir([shares[0], shares[2], shares[4]], wrappedSeed);

    expect(recovered).toEqual(seed);
  });

  it("throws InvalidShamirSharesError for below-threshold shares — AES-GCM's auth tag is the validity check, not shamir-secret-sharing's unvalidated combine()", async () => {
    const seed = generateMasterSeed();
    const { shares, wrappedSeed } = await splitSeedShamir(seed, 5, 3);

    await expect(combineSeedShamir([shares[0], shares[1]], wrappedSeed)).rejects.toBeInstanceOf(
      InvalidShamirSharesError
    ); // only 2 of 3 needed
  });

  it("supports different (n, k) configurations", async () => {
    const seed = generateMasterSeed();
    const { shares, wrappedSeed } = await splitSeedShamir(seed, 3, 2);
    expect(shares).toHaveLength(3);

    const recovered = await combineSeedShamir([shares[1], shares[2]], wrappedSeed);
    expect(recovered).toEqual(seed);
  });

  it("reissuing (splitting the same seed again) produces entirely different shares AND a different wrapped-seed ciphertext", async () => {
    const seed = generateMasterSeed();
    const first = await splitSeedShamir(seed, 3, 2);
    const second = await splitSeedShamir(seed, 3, 2);

    expect(first.shares[0]).not.toEqual(second.shares[0]);
    expect(first.shares[1]).not.toEqual(second.shares[1]);
    expect(first.shares[2]).not.toEqual(second.shares[2]);
    expect(first.wrappedSeed.ciphertext).not.toEqual(second.wrappedSeed.ciphertext);

    // Both sets still independently reconstruct the same seed against
    // their OWN generation's wrappedSeed.
    expect(await combineSeedShamir([first.shares[0], first.shares[1]], first.wrappedSeed)).toEqual(
      seed
    );
    expect(
      await combineSeedShamir([second.shares[1], second.shares[2]], second.wrappedSeed)
    ).toEqual(seed);
  });

  it("reissuing invalidates the old shares — the actual security property this indirection exists for", async () => {
    // This is the regression test for the vulnerability this design fixes:
    // an earlier version split the seed directly, so old shares could
    // reconstruct it forever regardless of how many times you "reissued."
    // Now reissuing replaces the wrappedSeed ciphertext old shares would
    // need to unwrap, so they become useless the moment the new generation
    // is confirmed — exactly like changing the passphrase invalidates the
    // old one.
    const seed = generateMasterSeed();
    const first = await splitSeedShamir(seed, 3, 2);
    const second = await splitSeedShamir(seed, 3, 2); // simulates a reissue overwriting Firestore's wrappedSeed

    // Old shares combined against the NEW (post-reissue) wrappedSeed must
    // fail, even though they're perfectly valid shares of a key that once
    // worked — because that key can't open the new ciphertext.
    await expect(
      combineSeedShamir([first.shares[0], first.shares[1]], second.wrappedSeed)
    ).rejects.toBeInstanceOf(InvalidShamirSharesError);
  });
});
