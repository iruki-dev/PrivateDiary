import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/contexts/Providers";
import { NavBar } from "@/components/NavBar";
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
  description: "누구도 아닌 나만 읽을 수 있는, 제로 지식 암호화 일기.",
  applicationName: "PrivateDiary",
  // A diary is a daily-use app people keep on a phone home screen; this is
  // what makes the installed shortcut open standalone instead of in a tab.
  appleWebApp: { capable: true, title: "PrivateDiary", statusBarStyle: "black-translucent" },
  // Nothing here should ever appear in a search result — the app is an
  // account-gated personal vault, not a public page.
  robots: { index: false, follow: false },
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
      <body
        className="flex min-h-full flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <Providers>
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
        </Providers>
      </body>
    </html>
  );
}
