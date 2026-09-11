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

const nextConfig: NextConfig = {
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
