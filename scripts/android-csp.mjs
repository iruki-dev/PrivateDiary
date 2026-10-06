/**
 * Content-Security-Policy for the Android app's bundled pages
 * (scripts/build-android-web.mjs). Kept apart from the build script so the
 * policy itself is unit-tested (scripts/__tests__/android-csp.test.ts).
 *
 * Stricter than the web policy (proxy.ts) wherever the app allows it:
 *  - script-src: 'self' plus the SHA-256 of each inline script on the page.
 *    No nonce, no 'strict-dynamic', no 'unsafe-*'.
 *  - frame-src 'none': the app never shows Google's sign-in popup in a
 *    frame (Android signs in natively — android/.../GoogleSignIn.kt), and
 *    Firebase Auth's hidden iframe is only loaded for popup/redirect flows.
 *  - form-action 'none': every form submits through JavaScript. If the JS
 *    failed to load, a native form submit would put typed values (a
 *    password) into a URL; this makes that a no-op instead.
 *  - base-uri 'none', object-src 'none', worker-src 'none'.
 */
import { createHash } from "node:crypto";

const FIREBASE_ENDPOINTS = [
  "https://firestore.googleapis.com",
  "https://identitytoolkit.googleapis.com",
  "https://securetoken.googleapis.com",
  "https://www.googleapis.com",
  "https://*.cloudfunctions.net",
];

/** Bodies of every <script> without a src attribute. */
export function inlineScripts(html) {
  const scripts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const [, attrs, body] of html.matchAll(pattern)) {
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (body.length === 0) continue;
    scripts.push(body);
  }
  return scripts;
}

export function inlineScriptHashes(html) {
  return [...new Set(inlineScripts(html).map((body) => createHash("sha256").update(body, "utf8").digest("base64")))];
}

/**
 * Things the hash policy can't allow without being loosened. Returns a
 * description per problem; an empty list means the page is safe to pin.
 */
export function findCspBlockers(html) {
  const blockers = [];
  for (const [, attrs] of html.matchAll(/<script\b([^>]*)>/gi)) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (src && /^(https?:)?\/\//i.test(src)) blockers.push(`script from another origin: ${src}`);
  }
  // Inline event handlers (onclick="…") can't be allowed by hash.
  for (const [match] of html.matchAll(/<[a-z][^>]*\son[a-z]+\s*=\s*["'][^>]*>/gi)) {
    blockers.push(`inline event handler: ${match.slice(0, 80)}`);
  }
  if (/javascript:/i.test(html.replace(/<script\b[\s\S]*?<\/script>/gi, ""))) {
    blockers.push("javascript: URL in markup");
  }
  return blockers;
}

export function buildAppCsp(scriptHashes) {
  const hashes = scriptHashes.map((hash) => `'sha256-${hash}'`).join(" ");
  return [
    "default-src 'self'",
    `script-src 'self'${hashes ? ` ${hashes}` : ""}`,
    // Same accepted weakening as the web (proxy.ts): React's style={{}}
    // and next/font. Styles can't execute or fetch from elsewhere.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${FIREBASE_ENDPOINTS.join(" ")}`,
    "frame-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * Links to the help, privacy or terms pages as paths inside the app. Those
 * pages aren't bundled (scripts/build-android-web.mjs); the app must link
 * to them on the website instead (lib/site.ts docHref).
 */
export function internalDocLinks(text) {
  const found = new Set();
  for (const [, path] of text.matchAll(/href(?:=|\\?"\s*:\s*\\?)["']?(\/(?:docs|privacy|terms)(?:[/#?][^"'\\\s]*)?)["'\\]/g)) {
    found.add(path);
  }
  return [...found];
}
