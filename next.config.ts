import type { NextConfig } from "next";

/**
 * ARCHITECTURE.md §6 security headers, adapted for Vercel (no Nginx —
 * Vercel terminates TLS and serves these at the edge). Content-Security-Policy
 * lives in middleware.ts instead, since it needs a fresh per-request nonce
 * for Next.js App Router's own inline hydration script — see that file for
 * why. Everything here is static and safe to set once.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/**
 * `BUILD_TARGET=android` (scripts/build-android-web.mjs) builds the same app
 * as plain static files for the Android app to bundle inside its APK
 * (android/README.md). Response headers and proxy.ts don't exist there —
 * the app's own WebView serves those files and sets the equivalent
 * headers itself (android/.../AppAssetServer.kt).
 */
const isAndroid = process.env.BUILD_TARGET === "android";

const nextConfig: NextConfig = isAndroid
  ? {
      output: "export",
      images: { unoptimized: true },
    }
  : {
      async headers() {
        return [
          {
            source: "/:path*",
            headers: securityHeaders,
          },
        ];
      },
    };

export default nextConfig;
