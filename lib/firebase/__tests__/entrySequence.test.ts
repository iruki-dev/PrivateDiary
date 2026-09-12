import { describe, expect, it } from "vitest";
import { checkEntrySequence } from "../entrySequence";

/**
 * checkEntrySequence is the detection half of ARCHITECTURE.md §3.4 that the
 * AES-GCM AAD binding structurally cannot cover: the AAD proves an entry
 * that IS present wasn't altered, but a backend that drops entries returns
 * a list which decrypts perfectly. entrySeq is a dense 1..N counter, so
 * absence is what's detectable here.
 */
const at = (entrySeq: number) => ({ entrySeq });

describe("checkEntrySequence", () => {
  it("accepts a dense, complete sequence", () => {
    expect(checkEntrySequence([at(3), at(2), at(1)], 3)).toEqual({
      ok: true,
      missingSeqs: [],
      duplicateSeqs: [],
      missingTailCount: 0,
    });
  });

  it("accepts an empty diary", () => {
    expect(checkEntrySequence([], 0).ok).toBe(true);
  });

  it("flags an entry deleted from the middle", () => {
    const result = checkEntrySequence([at(4), at(3), at(1)], 4);
    expect(result.ok).toBe(false);
    expect(result.missingSeqs).toEqual([2]);
    expect(result.missingTailCount).toBe(0);
  });

  it("flags several entries deleted from the middle, in order", () => {
    expect(checkEntrySequence([at(5), at(2)], 5).missingSeqs).toEqual([1, 3, 4]);
  });

  it("flags entries truncated off the tail, which gaps alone cannot reveal", () => {
    // 4 and 5 were written (the counter says so) but never came back. No
    // gap exists in what was returned, so only the counter catches this.
    const result = checkEntrySequence([at(3), at(2), at(1)], 5);
    expect(result.ok).toBe(false);
    expect(result.missingSeqs).toEqual([]);
    expect(result.missingTailCount).toBe(2);
  });

  it("flags the whole diary being withheld", () => {
    expect(checkEntrySequence([], 9)).toMatchObject({ ok: false, missingTailCount: 9 });
  });

  it("flags duplicate sequence numbers", () => {
    const result = checkEntrySequence([at(2), at(2), at(1)], 2);
    expect(result.ok).toBe(false);
    expect(result.duplicateSeqs).toEqual([2]);
  });

  it("reports gaps, duplicates and truncation together", () => {
    const result = checkEntrySequence([at(4), at(4), at(1)], 6);
    expect(result).toEqual({
      ok: false,
      missingSeqs: [2, 3],
      duplicateSeqs: [4],
      missingTailCount: 2,
    });
  });

  it("skips the tail check for accounts predating the counter", () => {
    // lastEntrySeq === null: the field didn't exist yet, so the tail is
    // unknowable — but gaps in what did come back are still reported.
    const result = checkEntrySequence([at(3), at(1)], null);
    expect(result.missingTailCount).toBe(0);
    expect(result.missingSeqs).toEqual([2]);
    expect(result.ok).toBe(false);
  });

  it("does not report a tail gap when more entries exist than the counter claims", () => {
    // A counter that lags (a write whose batch partially applied under an
    // older client) must not masquerade as tampering.
    expect(checkEntrySequence([at(2), at(1)], 1).missingTailCount).toBe(0);
  });
});
