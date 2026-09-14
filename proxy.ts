import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request CSP nonce (ARCHITECTURE.md §6/§7: strict CSP, inline scripts
 * blocked). Next.js App Router's own hydration payload ships as an inline
 * `<script>`, so a bare `script-src 'self'` (no 'unsafe-inline', no
 * WASM-related directives — see next.config.ts) would break the app; the
 * documented fix is a per-request nonce threaded through middleware:
 * https://nextjs.org/docs/app/guides/content-security-policy
 *
 * This is the ONLY thing that legitimately needs 'unsafe-eval'-free,
 * 'unsafe-inline'-free script-src to still work — no crypto code runs here,
 * this file never touches lib/crypto.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  // React reconstructs server-side error stacks in the browser via eval in
  // development only; production builds of neither React nor Next.js use
  // it. Gating this on NODE_ENV keeps `next dev` working without ever
  // shipping 'unsafe-eval' to production — the Next.js CSP guide's own
  // recommended shape.
  const isDev = process.env.NODE_ENV === "development";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // KNOWN, ACCEPTED WEAKENING. Tailwind's runtime-injected styles and
    // next/font's inline <style> have no nonce threaded through them, so
    // nonce-only style-src breaks the app's rendering outright. The
    // exposure is far narrower than 'unsafe-inline' on script-src: with
    // object-src 'none', base-uri 'self' and a nonce-only script-src, an
    // injected <style> can restyle the page but cannot execute, exfiltrate
    // via CSS (no external url() — style-src stays 'self'), or reframe it.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://*.cloudfunctions.net",
    // accounts.google.com: Google Sign-In (lib/firebase/auth.ts's
    // signInWithGoogle). *.firebaseapp.com: Firebase Auth's own hidden
    // iframe for cross-domain auth-state sync, needed regardless of which
    // sign-in method is used.
    "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // next.config.ts also sends X-Frame-Options: DENY, but that header is
    // the legacy mechanism and browsers prefer frame-ancestors where both
    // are present. Stating it here makes the clickjacking defense part of
    // the same policy as everything else rather than depending on a header
    // set in a different file.
    "frame-ancestors 'none'",
    // Any absolute http:// subresource that slips into the bundle gets
    // rewritten to https:// rather than silently downgrading the page.
    // Strict-Transport-Security (next.config.ts) covers the document
    // itself; this covers what the document pulls in.
    "upgrade-insecure-requests",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Skip static assets and image optimization internals — no need to
    // rewrite a nonce'd CSP onto responses that carry no HTML/scripts.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
