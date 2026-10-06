"use client";

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { usePathname } from "next/navigation";
import { DOC_GROUPS, docNeighbours } from "@/lib/docs";

function NavList() {
  const pathname = usePathname();
  return (
    <div className="space-y-6">
      {DOC_GROUPS.map((group) => (
        <div key={group.title}>
          <p className="faint mb-2 text-xs font-medium">{group.title}</p>
          <ul className="space-y-0.5">
            {group.pages.map((page) => {
              const current = pathname === page.href;
              return (
                <li key={page.href}>
                  <Link
                    href={page.href}
                    aria-current={current ? "page" : undefined}
                    className={`-mx-2 block rounded px-2 py-1.5 text-sm transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-ink ${
                      current
                        ? "bg-pill font-semibold"
                        : "text-ink-2 hover:text-ink"
                    }`}
                  >
                    {page.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Sidebar on wide screens; a collapsible table of contents above the article on phones. */
export function DocsSidebar() {
  return (
    <nav aria-label="도움말 목차" className="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-y-auto pb-8 lg:block">
      <Link href="/docs" className="mb-6 block text-sm font-semibold">
        도움말
      </Link>
      <NavList />
    </nav>
  );
}

export function DocsMobileToc() {
  const pathname = usePathname();
  return (
    // Keyed on the path so it closes again after navigating to a page.
    <details key={pathname} className="mb-8 rounded-2xl bg-surface lg:hidden">
      <summary className="group flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-[0.9375rem] font-semibold focus:outline-none focus-visible:outline-2 focus-visible:outline-ink [&::-webkit-details-marker]:hidden">
        도움말 목차
        <Icon name="chevron-right" size={18} strokeWidth={2} className="rotate-90 text-ink-3 transition-transform group-open:-rotate-90" />
      </summary>
      <div className="border-t border-line px-4 py-4">
        <NavList />
      </div>
    </details>
  );
}

export function DocsPager() {
  const pathname = usePathname();
  const { prev, next } = docNeighbours(pathname);
  if (!prev && !next) return null;
  return (
    <nav aria-label="이전·다음 문서" className="mt-16 grid grid-cols-2 gap-3 border-t border-line pt-6">
      {prev ? (
        <Link href={prev.href} className="rounded p-2 -m-2 text-sm hover:bg-fill focus:outline-none focus-visible:outline-2 focus-visible:outline-ink">
          <span className="faint block text-xs">이전</span>
          {prev.title}
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link href={next.href} className="rounded p-2 -m-2 text-right text-sm hover:bg-fill focus:outline-none focus-visible:outline-2 focus-visible:outline-ink">
          <span className="faint block text-xs">다음</span>
          {next.title}
        </Link>
      )}
    </nav>
  );
}
