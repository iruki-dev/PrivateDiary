"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_LINKS, useHasAccount } from "@/components/NavBar";

function PenIcon() {
  return (
    <path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4" />
  );
}

function BookIcon() {
  return (
    <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15ZM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7.5h6" />
  );
}

function GearIcon() {
  return (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.75v2.5M12 18.75v2.5M4.22 4.22l1.77 1.77M18.01 18.01l1.77 1.77M2.75 12h2.5M18.75 12h2.5M4.22 19.78l1.77-1.77M18.01 5.99l1.77-1.77" />
    </>
  );
}

const ICONS = { "/write": PenIcon, "/entries": BookIcon, "/settings": GearIcon } as const;

/**
 * True while an on-screen keyboard is covering a large part of the screen,
 * measured as the visual viewport shrinking well below the layout viewport.
 * Focus alone isn't the signal: /write autofocuses its textarea on load, and
 * on phones that doesn't open a keyboard.
 */
function subscribeViewport(onChange: () => void) {
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", onChange);
  return () => viewport?.removeEventListener("resize", onChange);
}
function keyboardOpenSnapshot(): boolean {
  const viewport = window.visualViewport;
  return !!viewport && viewport.height < window.innerHeight * 0.75;
}

/**
 * Bottom tab bar on phones, for a finished account. Replaces the old
 * hamburger menu: the app has exactly three places, and a daily habit
 * shouldn't take two taps (open menu, pick) to move between them.
 *
 * Steps aside while the on-screen keyboard is open, instead of riding up
 * on top of it and eating the writing area.
 */
export function TabBar() {
  const hasAccount = useHasAccount();
  const pathname = usePathname();
  const keyboardOpen = useSyncExternalStore(subscribeViewport, keyboardOpenSnapshot, () => false);
  if (!hasAccount) return null;

  return (
    <>
      {/* Reserves the bar's height at the end of the page so it never covers the last content. */}
      <div aria-hidden className="tabbar h-16 sm:hidden" />
      <nav
        aria-label="주 메뉴"
        hidden={keyboardOpen}
        className="tabbar fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-background/95 backdrop-blur sm:hidden dark:border-zinc-800"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto grid h-16 max-w-md grid-cols-3">
          {APP_LINKS.map(({ href, label }) => {
            const current = pathname === href || pathname.startsWith(`${href}/`);
            const Icon = ICONS[href];
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={`flex h-full flex-col items-center justify-center gap-1 text-[0.6875rem] transition-colors focus:outline-none focus-visible:bg-zinc-100 dark:focus-visible:bg-zinc-900 ${
                    current ? "font-semibold text-foreground" : "text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={current ? 2 : 1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-6 w-6"
                    aria-hidden
                  >
                    <Icon />
                  </svg>
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
