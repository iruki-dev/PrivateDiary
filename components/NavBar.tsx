"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useSeed } from "@/contexts/SeedContext";
import { signOut } from "@/lib/firebase/auth";

const LINKS = [
  { href: "/write", label: "쓰기" },
  { href: "/entries", label: "지난 일기" },
  { href: "/settings", label: "설정" },
];

/**
 * The one piece of persistent chrome in the app — every route below this
 * was previously an island reachable only by typing a URL or by whatever
 * one or two Links that specific page happened to include (e.g. /write
 * only linked to /entries, /settings linked nowhere). This is the fix,
 * responsive: an inline row of links on wider screens, collapsing into a
 * disclosure menu on narrow ones so it never wraps into a cramped second
 * line of Korean text on a phone.
 */
export function NavBar() {
  const { user, status: authStatus } = useAuth();
  const { status: seedStatus } = useSeed();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu automatically whenever the route changes — adjusted
  // during render (React's recommended "reset state when a prop changes"
  // pattern) rather than in an effect, which would cause an extra render.
  const [menuTrackedPathname, setMenuTrackedPathname] = useState(pathname);
  if (pathname !== menuTrackedPathname) {
    setMenuTrackedPathname(pathname);
    setMenuOpen(false);
  }

  const signedIn = authStatus === "signed-in" && seedStatus !== "not-issued";

  async function handleSignOut() {
    setMenuOpen(false);
    await signOut();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-background/90 backdrop-blur dark:border-zinc-800">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="link shrink-0 text-base font-semibold no-underline">
          PrivateDiary
        </Link>

        {signedIn && (
          <>
            {/* Desktop / wide-screen nav */}
            <nav className="hidden items-center gap-6 sm:flex" aria-label="주 메뉴">
              {LINKS.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={pathname === href ? "page" : undefined}
                  className={
                    pathname === href
                      ? "link text-sm font-medium"
                      : "link text-sm text-zinc-600 dark:text-zinc-400"
                  }
                >
                  {label}
                </Link>
              ))}
              <button type="button" onClick={() => void handleSignOut()} className="link text-sm text-zinc-600 dark:text-zinc-400">
                로그아웃
              </button>
            </nav>

            {/* Mobile menu toggle */}
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav-menu"
              aria-label={menuOpen ? "메뉴 닫기" : "메뉴 열기"}
              className="flex h-11 w-11 items-center justify-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/50 sm:hidden"
            >
              <span className="relative block h-4 w-5" aria-hidden="true">
                <span
                  className={`absolute left-0 top-0 h-0.5 w-5 bg-foreground transition-transform ${menuOpen ? "translate-y-[7px] rotate-45" : ""}`}
                />
                <span
                  className={`absolute left-0 top-[7px] h-0.5 w-5 bg-foreground transition-opacity ${menuOpen ? "opacity-0" : ""}`}
                />
                <span
                  className={`absolute left-0 top-[14px] h-0.5 w-5 bg-foreground transition-transform ${menuOpen ? "-translate-y-[7px] -rotate-45" : ""}`}
                />
              </span>
            </button>
          </>
        )}

        {!signedIn && authStatus === "signed-out" && (
          <Link href="/login" className="link text-sm">
            로그인
          </Link>
        )}
      </div>

      {signedIn && menuOpen && (
        <nav
          id="mobile-nav-menu"
          aria-label="주 메뉴 (모바일)"
          className="border-t border-zinc-200 px-4 pb-3 sm:hidden dark:border-zinc-800"
        >
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={pathname === href ? "page" : undefined}
                  className={
                    pathname === href
                      ? "flex min-h-12 items-center text-sm font-medium"
                      : "flex min-h-12 items-center text-sm text-zinc-600 dark:text-zinc-400"
                  }
                >
                  {label}
                </Link>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="flex min-h-12 w-full items-center text-left text-sm text-zinc-600 dark:text-zinc-400"
              >
                로그아웃{user?.email ? ` (${user.email})` : ""}
              </button>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
