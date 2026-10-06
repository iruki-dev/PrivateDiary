"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "@/contexts/AccountContext";
import { useSeed } from "@/contexts/SeedContext";
import { docHref } from "@/lib/site";

/** The three places a signed-in person moves between every day. */
export const APP_LINKS = [
  { href: "/write", label: "쓰기" },
  { href: "/entries", label: "일기장" },
  { href: "/settings", label: "설정" },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** True once there's a finished account — the app chrome only makes sense then. */
export function useHasAccount(): boolean {
  const { status: accountStatus } = useAccount();
  const { status: seedStatus } = useSeed();
  return accountStatus === "signed-in" && seedStatus !== "not-issued" && seedStatus !== "unknown";
}

/**
 * Top bar. Signed in: only on wide screens — the wordmark plus the three
 * app destinations. Phones get components/TabBar.tsx and a large title on
 * each screen instead; a wordmark bar above that title would spend 56px
 * of a phone screen saying the app's name on every page. Signed out: the
 * help docs and login, on every width.
 *
 * Sign-out and help deliberately aren't here for signed-in users: they're
 * occasional, and sign-out one tap away from "설정" in a row of identical
 * links is easy to hit by accident. Both live in /settings' 계정 group.
 */
export function NavBar() {
  const { status: authStatus } = useAccount();
  const hasAccount = useHasAccount();
  const pathname = usePathname();

  return (
    <header
      className={`sticky top-0 z-40 bg-background/90 backdrop-blur ${hasAccount ? "hidden sm:block" : ""}`}
    >
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5 sm:px-6">
        <Link
          href="/"
          className="shrink-0 rounded-md text-[1.0625rem] font-extrabold tracking-[-0.02em] focus:outline-none focus-visible:outline-2 focus-visible:outline-ink"
        >
          PrivateDiary
        </Link>

        {hasAccount && (
          <nav className="flex items-center gap-1" aria-label="주 메뉴">
            {APP_LINKS.map(({ href, label }) => {
              const current = isCurrent(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={`flex h-10 items-center rounded-full px-4 text-[0.9375rem] transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-ink ${
                    current ? "bg-pill font-bold text-ink" : "font-semibold text-ink-2 hover:bg-fill hover:text-ink"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        )}

        {!hasAccount && authStatus !== "signed-in" && (
          <nav className="flex items-center gap-1" aria-label="주 메뉴">
            <Link
              href={docHref("/docs")}
              aria-current={isCurrent(pathname, "/docs") ? "page" : undefined}
              className="btn-text"
            >
              도움말
            </Link>
            {pathname !== "/login" && (
              <Link href="/login" className="btn-primary btn-sm">
                로그인
              </Link>
            )}
          </nav>
        )}
      </div>
    </header>
  );
}
