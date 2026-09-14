import { defineConfig } from "vitest/config";

// Only otpFlow.integration.test.ts, which needs live auth/firestore/
// functions emulators — run via `pnpm test:integration`, which wraps this
// config in `firebase emulators:exec`. See that test file's doc comment.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
