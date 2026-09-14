import { defineConfig } from "vitest/config";

// Mirrors the root project's vitest.config.ts pattern: only pure-logic
// modules (no firebase-admin/firebase-functions imports) are covered here,
// so tests run without an emulator or credentials — see authFreshness.ts's
// module doc for why it's split out that way.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // otpFlow.integration.test.ts needs live auth/firestore/functions
    // emulators (see its own doc comment) — run it via `pnpm
    // test:integration` (vitest.integration.config.ts), not this default
    // config, so plain `pnpm test` stays emulator-free and fast.
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
  },
});
