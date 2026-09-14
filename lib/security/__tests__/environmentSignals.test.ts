import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectSyncEnvironmentWarnings,
  devtoolsWarning,
  probeDevtoolsOpen,
} from "../environmentSignals";

/**
 * These checks read `window`/`navigator`, which don't exist in vitest's
 * default "node" test environment (matching the rest of this app's
 * browser-only lib/firebase modules) — each test stubs only what it
 * needs via vi.stubGlobal, then unstubs everything afterward so later
 * tests see the real (absent) globals again.
 */
describe("environmentSignals", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("collectSyncEnvironmentWarnings", () => {
    it("returns nothing when window/navigator are absent (non-browser evaluation)", () => {
      expect(collectSyncEnvironmentWarnings()).toEqual([]);
    });

    it("warns on an insecure context", () => {
      vi.stubGlobal("window", { isSecureContext: false });
      const warnings = collectSyncEnvironmentWarnings();
      expect(warnings.map((w) => w.kind)).toContain("insecure-context");
    });

    it("does not warn on a secure context", () => {
      vi.stubGlobal("window", { isSecureContext: true });
      const warnings = collectSyncEnvironmentWarnings();
      expect(warnings.map((w) => w.kind)).not.toContain("insecure-context");
    });

    it("warns when navigator.webdriver is set (automation/remote-control tooling)", () => {
      vi.stubGlobal("window", { isSecureContext: true });
      vi.stubGlobal("navigator", { webdriver: true });
      const warnings = collectSyncEnvironmentWarnings();
      expect(warnings.map((w) => w.kind)).toContain("automation");
    });

    it("does not warn when navigator.webdriver is false/absent", () => {
      vi.stubGlobal("window", { isSecureContext: true });
      vi.stubGlobal("navigator", { webdriver: false });
      const warnings = collectSyncEnvironmentWarnings();
      expect(warnings.map((w) => w.kind)).not.toContain("automation");
    });

    it("can report both an insecure context and automation at once", () => {
      vi.stubGlobal("window", { isSecureContext: false });
      vi.stubGlobal("navigator", { webdriver: true });
      const kinds = collectSyncEnvironmentWarnings().map((w) => w.kind);
      expect(kinds).toEqual(expect.arrayContaining(["insecure-context", "automation"]));
    });
  });

  describe("probeDevtoolsOpen", () => {
    it("resolves false when window is absent", async () => {
      await expect(probeDevtoolsOpen()).resolves.toBe(false);
    });
  });

  describe("devtoolsWarning", () => {
    it("has the devtools-open kind", () => {
      expect(devtoolsWarning().kind).toBe("devtools-open");
    });
  });
});
