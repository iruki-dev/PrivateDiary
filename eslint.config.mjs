import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // functions/ is a separate TypeScript project (its own tsconfig.json,
    // own npm-managed node_modules) linted/type-checked independently —
    // see functions/package.json's own build script.
    "functions/**",
  ]),
]);

export default eslintConfig;
