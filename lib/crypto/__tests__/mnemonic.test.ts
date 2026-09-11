import { describe, expect, it } from "vitest";
import { generateMasterSeed } from "../random";
import { generateMnemonic, mnemonicToSeed } from "../mnemonic";
import { InvalidMnemonicError } from "../errors";

describe("generateMnemonic / mnemonicToSeed", () => {
  it("round-trips the exact 32-byte seed through a 24-word mnemonic", () => {
    const seed = generateMasterSeed();
    const mnemonic = generateMnemonic(seed);

    expect(mnemonic.trim().split(/\s+/)).toHaveLength(24);
    expect(mnemonicToSeed(mnemonic)).toEqual(seed);
  });

  it("rejects a mnemonic with an invalid checksum", () => {
    const mnemonic = generateMnemonic(generateMasterSeed());
    const words = mnemonic.split(" ");
    // swap two words to almost-certainly break the checksum
    [words[0], words[1]] = [words[1], words[0]];
    const corrupted = words.join(" ");

    expect(() => mnemonicToSeed(corrupted)).toThrow(InvalidMnemonicError);
  });

  it("rejects gibberish input", () => {
    expect(() => mnemonicToSeed("not a real mnemonic phrase at all")).toThrow(
      InvalidMnemonicError
    );
  });
});
