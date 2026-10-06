"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_LINKS, useHasAccount } from "@/components/NavBar";
import { useNative } from "@/contexts/NativeContext";
import { IS_ANDROID_APP } from "@/lib/platform";
import { Icon, type IconName } from "@/components/Icon";

const ICONS = {
  "/write": { idle: "pen", current: "pen-fill" },
  "/entries": { idle: "book", current: "book-fill" },
  "/settings": { idle: "gear", current: "gear-fill" },
} as const satisfies Record<string, { idle: IconName; current: IconName }>;

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
  const viewportKeyboardOpen = useSyncExternalStore(subscribeViewport, keyboardOpenSnapshot, () => false);
  // The Android app shrinks the whole page to sit above the keyboard, so
  // the viewport comparison above never fires there; the app says so instead.
  const { keyboardOpen: appKeyboardOpen } = useNative();
  const keyboardOpen = IS_ANDROID_APP ? appKeyboardOpen : viewportKeyboardOpen;
  if (!hasAccount) return null;

  return (
    <>
      {/* Reserves the bar's height at the end of the page so it never covers the last content. */}
      <div aria-hidden className="tabbar h-[4.5rem] sm:hidden" />
      <nav
        aria-label="주 메뉴"
        hidden={keyboardOpen}
        className="tabbar fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto grid h-[4.5rem] max-w-md grid-cols-3 pb-1.5">
          {APP_LINKS.map(({ href, label }) => {
            const current = pathname === href || pathname.startsWith(`${href}/`);
            const icons = ICONS[href];
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={`group flex h-full flex-col items-center justify-center gap-1 text-xs transition-colors focus:outline-none ${
                    current ? "font-bold text-ink" : "font-semibold text-ink-3"
                  }`}
                >
                  {/* Three cues, none of them colour: a pill (M3), a filled
                      icon (HIG) and a bolder label. */}
                  <span
                    className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors group-focus-visible:outline-2 group-focus-visible:outline-ink ${
                      current ? "bg-pill" : ""
                    }`}
                  >
                    <Icon name={current ? icons.current : icons.idle} />
                  </span>
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
