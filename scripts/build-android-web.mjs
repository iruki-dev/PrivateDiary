#!/usr/bin/env node
/**
 * Builds the web app as static files for the Android app to bundle inside
 * its APK (android/README.md), then hardens the output:
 *
 *  1. `next build` with BUILD_TARGET=android (next.config.ts → static
 *     export) and NEXT_PUBLIC_PLATFORM=android (lib/platform.ts).
 *  2. Pins every inline <script> by SHA-256 in a per-page
 *     Content-Security-Policy. The web build gets the same guarantee from
 *     proxy.ts's per-request nonce; a static file has no request, so it
 *     pins the exact scripts instead. Anything injected later — an XSS'd
 *     <script>, an inline handler — matches no hash and never runs.
 *  3. Fails the build on anything that CSP would have to be loosened for
 *     (inline event-handler attributes, scripts from another origin), so a
 *     future change can't quietly weaken the app's policy.
 *  4. Drops what the app doesn't carry: files that only make sense on a
 *     website (robots.txt, the PWA manifest and its icons), and the help,
 *     privacy and terms pages — the app links to those on the website
 *     (lib/site.ts docHref), so they stay current without a new app.
 *     Fails if any page still links to them internally.
 *  5. Copies the result to where the Android Gradle build picks it up.
 *
 * Usage: node scripts/build-android-web.mjs   (or: pnpm build:android-web)
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAppCsp, findCspBlockers, inlineScriptHashes, internalDocLinks } from "./android-csp.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "out");
const targetDir = join(root, "android", "app", "build", "generated", "webAssets", "web");

// Help, privacy and terms open on the website from the app (docHref).
const DOC_ROUTES = ["docs", "privacy", "terms"];

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
if (!/^https:\/\/[^/]+/.test(siteUrl)) {
  console.error(
    "NEXT_PUBLIC_SITE_URL must be the website's https address (e.g. https://privatediary.example) — " +
      "the app opens help, privacy and terms there. Set it in .env.local or the environment."
  );
  process.exit(1);
}

const WEB_ONLY_FILES = [
  "robots.txt",
  "sitemap.xml",
  "manifest.webmanifest",
  "apple-icon.png",
  "icon-192.png",
  "icon-512.png",
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

rmSync(outDir, { recursive: true, force: true });
execFileSync("npx", ["next", "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, BUILD_TARGET: "android", NEXT_PUBLIC_PLATFORM: "android" },
});

for (const name of WEB_ONLY_FILES) rmSync(join(outDir, name), { force: true });
for (const route of DOC_ROUTES) {
  rmSync(join(outDir, route), { recursive: true, force: true });
  rmSync(join(outDir, `${route}.html`), { force: true });
  rmSync(join(outDir, `${route}.txt`), { force: true });
}

const problems = [];
let pages = 0;
for (const file of walk(outDir).filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(file, "utf8");
  const where = relative(outDir, file);
  for (const blocker of findCspBlockers(html)) problems.push(`${where}: ${blocker}`);
  for (const link of internalDocLinks(html)) problems.push(`${where}: links to ${link} inside the app (use docHref)`);
  const csp = buildAppCsp(inlineScriptHashes(html));
  if (!html.includes("<head>")) {
    problems.push(`${where}: no <head> to put the Content-Security-Policy in`);
    continue;
  }
  // First thing in <head>: a meta CSP only governs what comes after it.
  writeFileSync(
    file,
    html.replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`)
  );
  pages += 1;
}
// Client-side navigation payloads carry the same links.
for (const file of walk(outDir).filter((f) => f.endsWith(".txt"))) {
  for (const link of internalDocLinks(readFileSync(file, "utf8"))) {
    problems.push(`${relative(outDir, file)}: links to ${link} inside the app (use docHref)`);
  }
}
if (problems.length > 0) {
  console.error("\nThe Android bundle has problems:\n  " + problems.join("\n  "));
  process.exit(1);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });
cpSync(outDir, targetDir, { recursive: true });

// Fingerprint of exactly what goes into the APK, for comparing two builds.
const digest = createHash("sha256");
for (const file of walk(targetDir).sort()) {
  digest.update(relative(targetDir, file));
  digest.update(readFileSync(file));
}
console.log(`\nAndroid web bundle: ${pages} pages, CSP pinned, sha256 ${digest.digest("hex").slice(0, 16)}…`);
console.log(`→ ${relative(root, targetDir)}`);
