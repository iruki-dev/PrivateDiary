"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Building blocks for /settings: titled groups of rows, each row a label,
 * an optional one-line description, and a control on the right. Flows
 * that need more room (proving the passphrase, showing new backup codes)
 * open inside the row via `children`, so the page keeps its shape.
 */

export function SettingsGroup({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="scroll-mt-20 space-y-2">
      <h2 id={id ? `${id}-title` : undefined} className="faint px-1 text-xs font-medium">
        {title}
      </h2>
      <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-background dark:divide-zinc-800 dark:border-zinc-800">
        {children}
      </div>
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  control,
  children,
  tone = "default",
  htmlFor,
}: {
  label: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  tone?: "default" | "danger";
  /** When the control is a native input, ties the label to it. */
  htmlFor?: string;
}) {
  const LabelTag = htmlFor ? "label" : "p";
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 space-y-0.5">
          <LabelTag
            {...(htmlFor ? { htmlFor } : {})}
            className={`block text-sm font-medium ${tone === "danger" ? "text-red-700 dark:text-red-500" : ""}`}
          >
            {label}
          </LabelTag>
          {description && <div className="faint text-xs leading-relaxed">{description}</div>}
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

/** Row that navigates somewhere, with a chevron. */
export function SettingsLinkRow({ href, label, description }: { href: string; label: string; description?: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:bg-zinc-100 dark:hover:bg-zinc-900/60 dark:focus-visible:bg-zinc-900"
    >
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="faint text-xs">{description}</p>}
      </div>
      <span aria-hidden className="faint">
        ›
      </span>
    </Link>
  );
}

/** An on/off switch (role="switch"). The visible row label names it via aria-label. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/50 focus-visible:ring-offset-2 disabled:opacity-50 dark:focus-visible:ring-offset-zinc-950 ${
        checked ? "bg-foreground" : "bg-zinc-300 dark:bg-zinc-700"
      }`}
    >
      <span
        aria-hidden
        className={`inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

/** Small inline "자세히" link into the help docs. */
export function MoreLink({ href }: { href: string }) {
  return (
    <Link href={href} className="whitespace-nowrap underline underline-offset-2 hover:opacity-70">
      자세히
    </Link>
  );
}
