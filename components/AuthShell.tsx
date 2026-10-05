import type { ReactNode } from "react";

/**
 * Shared frame for the signed-out account screens (login, signup): the
 * same centred narrow column and heading those pages already used, kept in
 * one place so they stay one family.
 */
export function AuthShell({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="page-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">{title}</h1>
          {lead && <div className="muted">{lead}</div>}
        </div>
        {children}
      </div>
    </main>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
      <div className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
      또는
      <div className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
    </div>
  );
}
