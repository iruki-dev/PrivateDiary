import { describe, expect, it } from "vitest";
import { padEntryPlaintext, paddedEntryLength, unpadEntryPlaintext } from "../padding";
import { ENTRY_LENGTH_PREFIX_BYTES, MIN_PADDED_ENTRY_LENGTH } from "../constants";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("paddedEntryLength", () => {
  it("never returns less than the input, so content always fits", () => {
    for (const length of [0, 1, 100, 1023, 1024, 5000, 100_000, 374_000]) {
      expect(paddedEntryLength(length)).toBeGreaterThanOrEqual(length);
    }
  });

  it("collapses everything at or below the floor to one size", () => {
    const sizes = [0, 1, 5, 100, 500, MIN_PADDED_ENTRY_LENGTH].map(paddedEntryLength);
    expect(new Set(sizes).size).toBe(1);
    expect(sizes[0]).toBe(MIN_PADDED_ENTRY_LENGTH);
  });

  it("is monotonic — a longer entry never pads to a smaller size", () => {
    let previous = 0;
    for (let length = 0; length <= 20_000; length += 7) {
      const padded = paddedEntryLength(length);
      expect(padded).toBeGreaterThanOrEqual(previous);
      previous = padded;
    }
  });

  it("keeps overhead under Padmé's ~12% bound", () => {
    for (let length = MIN_PADDED_ENTRY_LENGTH; length <= 400_000; length += 311) {
      expect(paddedEntryLength(length)).toBeLessThanOrEqual(Math.ceil(length * 1.12));
    }
  });

  it("leaves exact bucket boundaries alone instead of jumping a whole bucket", () => {
    // Rounding up a value that is already on a boundary would double the
    // cost for the most common sizes and is the classic off-by-one here.
    for (const length of [1024, 2048, 4096, 8192, 65_536]) {
      expect(paddedEntryLength(length)).toBe(length);
    }
  });

  it("collapses many distinct lengths into far fewer observable sizes", () => {
    // The actual security property: an observer counting ciphertext bytes
    // must not be able to recover the plaintext length.
    const lengths = Array.from({ length: 4000 }, (_, i) => i + 1);
    const distinctPadded = new Set(lengths.map(paddedEntryLength));
    expect(distinctPadded.size).toBeLessThan(lengths.length / 40);
  });
});

describe("padEntryPlaintext / unpadEntryPlaintext", () => {
  it("round-trips an ordinary entry", () => {
    const text = "오늘은 좋은 하루였다.\n\n두 번째 문단.";
    expect(decode(unpadEntryPlaintext(padEntryPlaintext(encode(text))))).toBe(text);
  });

  it("round-trips an empty entry", () => {
    expect(unpadEntryPlaintext(padEntryPlaintext(new Uint8Array(0)))).toHaveLength(0);
  });

  it("round-trips an entry far longer than the floor", () => {
    const text = "가".repeat(50_000);
    expect(decode(unpadEntryPlaintext(padEntryPlaintext(encode(text))))).toBe(text);
  });

  it("round-trips content that is itself all zero bytes", () => {
    // Zero bytes are also the padding filler, so this is the case a naive
    // "strip trailing zeros" scheme would silently corrupt.
    const content = new Uint8Array(64); // all 0x00
    const recovered = unpadEntryPlaintext(padEntryPlaintext(content));
    expect(recovered).toHaveLength(64);
    expect(recovered.every((byte) => byte === 0)).toBe(true);
  });

  it("pads short entries of different lengths to an identical size", () => {
    const a = padEntryPlaintext(encode("힘들다"));
    const b = padEntryPlaintext(encode("가".repeat(200)));
    expect(a.length).toBe(b.length);
    expect(a.length).toBe(MIN_PADDED_ENTRY_LENGTH);
  });

  it("zero-fills the padding rather than leaving uninitialized memory", () => {
    const record = padEntryPlaintext(encode("짧은 글"));
    const contentEnd = ENTRY_LENGTH_PREFIX_BYTES + encode("짧은 글").length;
    expect(record.subarray(contentEnd).every((byte) => byte === 0)).toBe(true);
  });

  it("rejects a record shorter than its own length prefix", () => {
    expect(() => unpadEntryPlaintext(new Uint8Array(2))).toThrow(RangeError);
  });

  it("rejects a length prefix claiming more content than the record holds", () => {
    const record = padEntryPlaintext(encode("hello"));
    new DataView(record.buffer).setUint32(0, record.length, false);
    expect(() => unpadEntryPlaintext(record)).toThrow(RangeError);
  });

  it("reads a record that is a view into a larger buffer", () => {
    // Web Crypto hands back fresh ArrayBuffers, but a Uint8Array with a
    // non-zero byteOffset is easy to produce and would break a DataView
    // constructed without one.
    const record = padEntryPlaintext(encode("오프셋"));
    const backing = new Uint8Array(record.length + 8);
    backing.set(record, 8);
    const view = backing.subarray(8);
    expect(decode(unpadEntryPlaintext(view))).toBe("오프셋");
  });
});
