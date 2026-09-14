import { defineConfig } from "vitest/config";

// Every *.integration.test.ts file (otpFlow, entryRateLimit) needs live
// auth/firestore/functions emulators — run via `pnpm test:integration`,
// which wraps this config in `firebase emulators:exec`. See each test
// file's own doc comment.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
