import { describe, expect, it } from "vitest";
import { isLockedExport, lockExport, unlockExport } from "../archive";
import { WrongPassphraseError } from "../errors";

describe("locked export files", () => {
  const text = JSON.stringify({ format: "privatediary-export", entries: [{ text: "바닷가에 갔다" }] });

  it("round-trips with the right password", async () => {
    const file = await lockExport(text, "correct horse battery staple");
    expect(isLockedExport(file)).toBe(true);
    expect(file.ciphertext).not.toContain("바닷가");
    expect(await unlockExport(file, "correct horse battery staple")).toBe(text);
  });

  it("survives a trip through JSON, as a saved file does", async () => {
    const file = JSON.parse(JSON.stringify(await lockExport(text, "pw pw pw pw")));
    expect(isLockedExport(file)).toBe(true);
    expect(await unlockExport(file, "pw pw pw pw")).toBe(text);
  });

  it("refuses a wrong password", async () => {
    const file = await lockExport(text, "right one");
    await expect(unlockExport(file, "wrong one")).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("refuses a header that was changed, even with the right password", async () => {
    const file = await lockExport(text, "right one");
    await expect(
      unlockExport({ ...file, kdf: { ...file.kdf, iterations: file.kdf.iterations + 1 } }, "right one")
    ).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("refuses to run a weakened or absurd key derivation at all", async () => {
    const file = await lockExport(text, "right one");
    await expect(unlockExport({ ...file, kdf: { ...file.kdf, iterations: 1000 } }, "right one")).rejects.toBeInstanceOf(
      WrongPassphraseError
    );
    await expect(
      unlockExport({ ...file, kdf: { ...file.kdf, iterations: 1_000_000_000 } }, "right one")
    ).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("recognises only its own format", () => {
    expect(isLockedExport({ format: "privatediary-export" })).toBe(false);
    expect(isLockedExport(null)).toBe(false);
  });
});
