import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * nativeIntegrity.ts keeps its "earliest reference seen" baseline as
 * module-level state (deliberately — see that module's doc comment on why
 * a later check must never quietly re-baseline). Every test here needs a
 * FRESH module instance, so each imports via `vi.resetModules()` + a
 * dynamic `import()` rather than a static top-level import.
 */
describe("nativeIntegrity", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("isLikelyNativeFunction", () => {
    it("recognizes an actual browser/runtime native as native", async () => {
      const { isLikelyNativeFunction } = await import("../nativeIntegrity");
      expect(isLikelyNativeFunction(Array.prototype.map)).toBe(true);
      expect(isLikelyNativeFunction(JSON.stringify)).toBe(true);
    });

    it("does not recognize a plain JS function as native", async () => {
      const { isLikelyNativeFunction } = await import("../nativeIntegrity");
      expect(isLikelyNativeFunction(function wrapped() {})).toBe(false);
      expect(isLikelyNativeFunction(() => {})).toBe(false);
    });

    it("does not recognize a function whose OWN .toString was overridden to lie", async () => {
      const { isLikelyNativeFunction } = await import("../nativeIntegrity");
      function hook() {}
      hook.toString = () => "function hook() { [native code] }";
      // isLikelyNativeFunction must call the module's captured
      // Function.prototype.toString, never `fn.toString()` — otherwise
      // this exact self-lying trick would defeat it trivially.
      expect(isLikelyNativeFunction(hook)).toBe(false);
    });

    it("returns false for non-function values instead of throwing", async () => {
      const { isLikelyNativeFunction } = await import("../nativeIntegrity");
      expect(isLikelyNativeFunction(42)).toBe(false);
      expect(isLikelyNativeFunction(null)).toBe(false);
      expect(isLikelyNativeFunction(undefined)).toBe(false);
      expect(isLikelyNativeFunction("function () { [native code] }")).toBe(false);
    });
  });

  describe("checkNativeIntegrity", () => {
    it("reports ok when nothing has been swapped", async () => {
      const { checkNativeIntegrity } = await import("../nativeIntegrity");
      const result = checkNativeIntegrity();
      expect(result.ok).toBe(true);
      expect(result.tampered).toEqual([]);
    });

    it("detects a global replaced AFTER this module's baseline was captured — the realistic case: an extension injecting after page load", async () => {
      const { checkNativeIntegrity } = await import("../nativeIntegrity");
      expect(checkNativeIntegrity().ok).toBe(true); // establishes the baseline

      const original = JSON.stringify;
      const hook = ((value: unknown) => original(value)) as typeof JSON.stringify;
      JSON.stringify = hook;
      try {
        const result = checkNativeIntegrity();
        expect(result.ok).toBe(false);
        expect(result.tampered).toContain("JSON.stringify");
      } finally {
        JSON.stringify = original;
      }
    });

    it("stops matching once restored to the exact original reference", async () => {
      const { checkNativeIntegrity } = await import("../nativeIntegrity");
      checkNativeIntegrity();
      const original = Array.prototype.map;
      // try/finally, not a bare mutate-then-restore: Array.prototype.map is
      // a shared global every other test (and vitest's own internals) also
      // rely on — if an assertion above threw before the restore line ran,
      // it would stay corrupted for the rest of the process, not just this
      // test. (Caught in review by deliberately breaking the production
      // check and watching the whole suite hang instead of failing cleanly.)
      Array.prototype.map = function fakeMap() {
        return [];
      } as typeof Array.prototype.map;
      try {
        expect(checkNativeIntegrity().tampered).toContain("Array.prototype.map");
      } finally {
        Array.prototype.map = original;
      }
      expect(checkNativeIntegrity().tampered).not.toContain("Array.prototype.map");
    });

    it("keeps flagging a swap even if the hook itself changes again later, rather than trusting whatever is currently installed as a new baseline", async () => {
      const { checkNativeIntegrity } = await import("../nativeIntegrity");
      checkNativeIntegrity();
      const original = JSON.parse;
      const hook1 = ((text: string) => original(text)) as typeof JSON.parse;
      const hook2 = ((text: string) => original(text)) as typeof JSON.parse;
      try {
        JSON.parse = hook1;
        expect(checkNativeIntegrity().tampered).toContain("JSON.parse");
        JSON.parse = hook2;
        expect(checkNativeIntegrity().tampered).toContain("JSON.parse");
      } finally {
        JSON.parse = original;
      }
    });

    it("does not false-positive on unrelated APIs while one is tampered", async () => {
      const { checkNativeIntegrity } = await import("../nativeIntegrity");
      checkNativeIntegrity();
      const original = JSON.stringify;
      JSON.stringify = ((value: unknown) => original(value)) as typeof JSON.stringify;
      try {
        const result = checkNativeIntegrity();
        expect(result.tampered).toEqual(["JSON.stringify"]);
      } finally {
        JSON.stringify = original;
      }
    });
  });

  describe("assertNativeIntegrity", () => {
    it("does not throw when nothing is tampered", async () => {
      const { assertNativeIntegrity } = await import("../nativeIntegrity");
      expect(() => assertNativeIntegrity()).not.toThrow();
    });

    it("throws EnvironmentTamperedError, naming the tampered API, once something is swapped", async () => {
      const { assertNativeIntegrity, checkNativeIntegrity, EnvironmentTamperedError } = await import(
        "../nativeIntegrity"
      );
      checkNativeIntegrity();
      const original = JSON.stringify;
      JSON.stringify = ((value: unknown) => original(value)) as typeof JSON.stringify;
      try {
        expect(() => assertNativeIntegrity()).toThrow(EnvironmentTamperedError);
        try {
          assertNativeIntegrity();
          expect.unreachable();
        } catch (err) {
          expect(err).toBeInstanceOf(EnvironmentTamperedError);
          expect((err as InstanceType<typeof EnvironmentTamperedError>).tampered).toContain(
            "JSON.stringify"
          );
        }
      } finally {
        JSON.stringify = original;
      }
    });
  });
});
