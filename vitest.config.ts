import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", // Node 20+'s global crypto.subtle (Web Crypto) covers what lib/crypto needs
    include: ["lib/**/*.test.ts", "*.test.ts"],
  },
});
