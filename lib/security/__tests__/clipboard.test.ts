import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyWithAutoClear, DEFAULT_CLEAR_AFTER_MS } from "../clipboard";

describe("copyWithAutoClear", () => {
  let writeText: ReturnType<typeof vi.fn>;
  let readText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    writeText = vi.fn().mockResolvedValue(undefined);
    readText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText, readText } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("writes the text immediately", async () => {
    await copyWithAutoClear("shamir-share-1");
    expect(writeText).toHaveBeenCalledWith("shamir-share-1");
  });

  it("clears the clipboard after the delay if it still holds exactly what was copied", async () => {
    readText.mockResolvedValue("shamir-share-1");
    await copyWithAutoClear("shamir-share-1", 1000);

    await vi.advanceTimersByTimeAsync(1000);

    expect(readText).toHaveBeenCalled();
    expect(writeText).toHaveBeenLastCalledWith("");
  });

  it("does NOT clear the clipboard if the user copied something else in the meantime", async () => {
    readText.mockResolvedValue("something the user copied afterward");
    await copyWithAutoClear("shamir-share-1", 1000);

    await vi.advanceTimersByTimeAsync(1000);

    expect(writeText).toHaveBeenCalledTimes(1); // only the original write, never the clear
    expect(writeText).not.toHaveBeenCalledWith("");
  });

  it("degrades silently when clipboard-read is unavailable/denied", async () => {
    readText.mockRejectedValue(new Error("NotAllowedError"));
    await copyWithAutoClear("shamir-share-1", 1000);

    await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("uses a 30s default delay", async () => {
    readText.mockResolvedValue("x");
    await copyWithAutoClear("x");

    await vi.advanceTimersByTimeAsync(DEFAULT_CLEAR_AFTER_MS - 1);
    expect(writeText).toHaveBeenCalledTimes(1); // not yet

    await vi.advanceTimersByTimeAsync(1);
    expect(writeText).toHaveBeenCalledTimes(2); // cleared right at the default delay
  });
});
