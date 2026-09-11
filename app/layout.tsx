import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/contexts/Providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PrivateDiary",
  description: "Zero-knowledge encrypted diary",
};

/**
 * Forces every route to render per-request instead of being statically
 * prerendered at build time. This app has no per-request server data (it's
 * entirely client-driven auth/Firestore calls), so the only reason for this
 * is proxy.ts's CSP nonce: Next.js can only embed a matching nonce into a
 * page's own inline hydration script when that page is actually rendered
 * for the current request — a build-time-frozen static page has no request
 * to derive a nonce from, so 'script-src' would need 'unsafe-inline' to
 * avoid breaking hydration. Given ARCHITECTURE.md §7's "인라인 스크립트
 * 차단" requirement, the (small, personal-app-scale) cost of dynamic
 * rendering everywhere is worth it to keep script-src nonce-only.
 */
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
