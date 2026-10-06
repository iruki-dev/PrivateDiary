import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Same "@/…" imports as the app (tsconfig.json's paths).
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node", // Node 20+'s global crypto.subtle (Web Crypto) covers what lib/crypto needs
    include: ["lib/**/*.test.ts", "scripts/**/*.test.ts", "*.test.ts"],
  },
});
