import { describe, expect, it } from "vitest";
import { generateMasterSeed } from "../random";
import { rewrapSeed, unwrapSeed, wrapSeed } from "../passphrase";
import { WrongPassphraseError } from "../errors";

describe("wrapSeed / unwrapSeed", () => {
  it("round-trips: wrap then unwrap with the same passphrase recovers the seed", async () => {
    const seed = generateMasterSeed();
    const wrapped = await wrapSeed(seed, "correct horse battery staple pond kayak");

    const recovered = await unwrapSeed(wrapped, "correct horse battery staple pond kayak");

    expect(recovered).toEqual(seed);
  });

  it("uses a fresh random salt every call, even for the same seed+passphrase", async () => {
    const seed = generateMasterSeed();
    const a = await wrapSeed(seed, "same passphrase");
    const b = await wrapSeed(seed, "same passphrase");

    expect(a.salt).not.toEqual(b.salt);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it("rejects the wrong passphrase", async () => {
    const seed = generateMasterSeed();
    const wrapped = await wrapSeed(seed, "right passphrase");

    await expect(unwrapSeed(wrapped, "wrong passphrase")).rejects.toThrow(
      WrongPassphraseError
    );
  });
});

describe("rewrapSeed", () => {
  it("re-wraps under a new passphrase; old entries decrypt with the new passphrase", async () => {
    const seed = generateMasterSeed();
    const wrapped = await wrapSeed(seed, "old passphrase");

    const rewrapped = await rewrapSeed(wrapped, "old passphrase", "new passphrase");

    const recovered = await unwrapSeed(rewrapped, "new passphrase");
    expect(recovered).toEqual(seed);
    // the old passphrase no longer works against the re-wrapped blob
    await expect(unwrapSeed(rewrapped, "old passphrase")).rejects.toThrow(
      WrongPassphraseError
    );
  });

  it("fails and changes nothing if the old passphrase is wrong", async () => {
    const seed = generateMasterSeed();
    const wrapped = await wrapSeed(seed, "old passphrase");

    await expect(
      rewrapSeed(wrapped, "totally wrong", "new passphrase")
    ).rejects.toThrow(WrongPassphraseError);

    // original wrapped blob still opens with the original passphrase
    const recovered = await unwrapSeed(wrapped, "old passphrase");
    expect(recovered).toEqual(seed);
  });
});
