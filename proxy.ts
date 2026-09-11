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

  const csp = [
    "default-src 'self'",
    // 'strict-dynamic' alone should let App Check's reCAPTCHA v3 script
    // (injected by an already-trusted, nonce'd script — lib/firebase/appCheck.ts)
    // load regardless of host, but the explicit google.com/gstatic.com
    // sources stay as the documented fallback for browsers that don't
    // support strict-dynamic (same pattern Google's own CSP guide uses).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://www.google.com https://www.gstatic.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://www.gstatic.com",
    "font-src 'self'",
    // App Check/reCAPTCHA v3 (README.md "DDoS 방지"): www.google.com for the
    // reCAPTCHA verify call, {content-,}firebaseappcheck.googleapis.com for
    // exchanging that for an App Check token. No-ops until
    // NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY is actually set.
    "connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://*.cloudfunctions.net https://www.google.com https://firebaseappcheck.googleapis.com https://content-firebaseappcheck.googleapis.com",
    "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://www.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
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
