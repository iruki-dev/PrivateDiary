import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/contexts/Providers";
import { NavBar } from "@/components/NavBar";
import { TabBar } from "@/components/TabBar";
import { SecurityWarningBanner } from "@/components/SecurityWarningBanner";
import { SITE } from "@/lib/site";
import { IS_ANDROID_APP } from "@/lib/platform";
import { connection } from "next/server";
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
  metadataBase: new URL(SITE.url),
  title: { default: SITE.name, template: `%s · ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  // A diary is a daily-use app people keep on a phone home screen; this is
  // what makes the installed shortcut open standalone instead of in a tab.
  appleWebApp: { capable: true, title: SITE.name, statusBarStyle: "black-translucent" },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: SITE.name,
    title: SITE.name,
    description: SITE.description,
  },
  // Only the public pages (landing, security, legal) are indexable. Every
  // account page opts back out in its own segment layout (app/write,
  // entries, settings) — those are a personal vault, never a search
  // result. app/robots.ts says the same to crawlers.
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  // Matches app/globals.css's light/dark --background exactly, so the
  // mobile browser chrome (status bar / address bar) never mismatches the
  // page itself when switching themes.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  // Next.js sets width=device-width/initial-scale=1 by default; this only
  // adds viewport-fit=cover so safe-area-inset-* below actually has
  // something to measure on notched/home-indicator devices.
  viewportFit: "cover",
};

/**
 * Web: every route renders per-request instead of being statically
 * prerendered at build time. This app has no per-request server data (it's
 * entirely client-driven auth/Firestore calls), so the only reason for this
 * is proxy.ts's CSP nonce: Next.js can only embed a matching nonce into a
 * page's own inline hydration script when that page is actually rendered
 * for the current request — a build-time-frozen static page has no request
 * to derive a nonce from, so 'script-src' would need 'unsafe-inline' to
 * avoid breaking hydration. Given ARCHITECTURE.md §7's "인라인 스크립트
 * 차단" requirement, the (small, personal-app-scale) cost of dynamic
 * rendering everywhere is worth it to keep script-src nonce-only.
 *
 * Android: the opposite. The app ships these pages as static files inside
 * the signed APK, so there is no server and no request — and that is the
 * point: the code the app runs can't be swapped by whoever controls a
 * server. Its CSP pins each inline script by hash instead of a nonce
 * (scripts/build-android-web.mjs).
 *
 * `await connection()` rather than `export const dynamic = "force-dynamic"`
 * because segment config has to be a literal, and the Android build is
 * the same source with IS_ANDROID_APP inlined at build time.
 */

export default async function RootLayout({ children }: LayoutProps<"/">) {
  if (!IS_ANDROID_APP) await connection();
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      data-platform={IS_ANDROID_APP ? "android" : undefined}
    >
      <body
        className="flex min-h-full flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <Providers>
          <SecurityWarningBanner />
          {/* Keyboard users would otherwise tab through the whole nav on
              every route before reaching the entry they were reading or the
              textarea they were writing in. The .sr-only-focusable utility
              in globals.css exists for exactly this and had no caller. */}
          <a href="#main-content" className="sr-only-focusable btn-primary absolute left-4 top-4 z-50">
            본문으로 건너뛰기
          </a>
          <NavBar />
          {/* A real flex item, not a display:contents wrapper: the pages
              below are `flex flex-1` children of <body>, and this has to
              pass that sizing straight through while still being a focus
              target the skip link can land on. */}
          <div id="main-content" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
            {children}
          </div>
          <TabBar />
        </Providers>
      </body>
    </html>
  );
}
