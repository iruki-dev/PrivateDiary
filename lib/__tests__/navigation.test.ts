import { describe, expect, it } from "vitest";
import { DEFAULT_SIGNED_IN_PATH, loginPathFor, safeNextPath } from "../navigation";

describe("safeNextPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeNextPath("/entries")).toBe("/entries");
    expect(safeNextPath("/settings#backup")).toBe("/settings#backup");
  });

  it("falls back to the dashboard when absent", () => {
    expect(safeNextPath(null)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNextPath("")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("rejects anything that could leave the origin", () => {
    for (const raw of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "javascript:alert(1)",
      "entries",
    ]) {
      expect(safeNextPath(raw)).toBe(DEFAULT_SIGNED_IN_PATH);
    }
  });
});

describe("loginPathFor", () => {
  it("encodes the return path", () => {
    expect(loginPathFor("/entries")).toBe("/login?next=%2Fentries");
  });

  it("omits next for the default destination", () => {
    expect(loginPathFor(DEFAULT_SIGNED_IN_PATH)).toBe("/login");
  });
});
