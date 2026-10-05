import type { ReactNode } from "react";

/**
 * Shared frame for the signed-out account screens (login, signup and its
 * steps): one narrow card, a heading, an optional lead paragraph. Keeps
 * those screens visually one family instead of three ad-hoc layouts.
 */
export function AuthShell({
  title,
  lead,
  eyebrow,
  children,
  footer,
}: {
  title: string;
  lead?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col items-center px-4 py-10 sm:px-6 sm:py-16">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-2">
          {eyebrow}
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {lead && <div className="muted leading-relaxed">{lead}</div>}
        </header>
        {children}
        {footer && <div className="border-t border-zinc-200 pt-5 text-center text-sm dark:border-zinc-800">{footer}</div>}
      </div>
    </main>
  );
}

export function OrDivider() {
  return (
    <div className="faint flex items-center gap-3 text-xs" role="separator">
      <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      또는
      <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

/** Google's "G" mark, monochrome — no icon library in this codebase. */
export function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="currentColor"
        d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.96S8.78 6.26 12 6.26c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.68 3.7 14.55 2.8 12 2.8 6.92 2.8 2.8 6.92 2.8 12s4.12 9.2 9.2 9.2c5.31 0 8.83-3.73 8.83-8.99 0-.6-.07-1.06-.15-1.51Z"
      />
    </svg>
  );
}
