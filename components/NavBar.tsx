"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useSeed } from "@/contexts/SeedContext";
import { docHref } from "@/lib/site";

/** The three places a signed-in person moves between every day. */
export const APP_LINKS = [
  { href: "/write", label: "쓰기" },
  { href: "/entries", label: "지난 일기" },
  { href: "/settings", label: "설정" },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** True once there's a finished account — the app chrome only makes sense then. */
export function useHasAccount(): boolean {
  const { status: authStatus } = useAuth();
  const { status: seedStatus } = useSeed();
  return authStatus === "signed-in" && seedStatus !== "not-issued" && seedStatus !== "unknown";
}

/**
 * Top bar. Signed in: the wordmark plus, on wide screens, the three app
 * destinations (phones get components/TabBar.tsx instead — a daily-use app
 * shouldn't hide its only three places behind a menu button). Signed out:
 * the help docs and login.
 *
 * Sign-out and help deliberately aren't here for signed-in users: they're
 * occasional, and sign-out one tap away from "설정" in a row of identical
 * links is easy to hit by accident. Both live in /settings' 계정 group.
 */
export function NavBar() {
  const { status: authStatus } = useAuth();
  const hasAccount = useHasAccount();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-background/90 backdrop-blur dark:border-zinc-800">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="shrink-0 rounded-sm text-base font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/50"
        >
          PrivateDiary
        </Link>

        {hasAccount && (
          <nav className="hidden items-center gap-1 sm:flex" aria-label="주 메뉴">
            {APP_LINKS.map(({ href, label }) => {
              const current = isCurrent(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={`rounded px-3 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/50 ${
                    current
                      ? "bg-zinc-100 font-medium text-foreground dark:bg-zinc-900"
                      : "text-zinc-600 hover:text-foreground dark:text-zinc-400"
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
              className="rounded px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/50 dark:text-zinc-400"
            >
              도움말
            </Link>
            {pathname !== "/login" && (
              <Link
                href="/login"
                className="rounded px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/50 dark:hover:bg-zinc-900"
              >
                로그인
              </Link>
            )}
          </nav>
        )}
      </div>
    </header>
  );
}
