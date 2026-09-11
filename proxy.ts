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
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://*.cloudfunctions.net",
    "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
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
