"use client";

import Link from "next/link";
import { Children, type ReactNode } from "react";
import { Icon } from "@/components/Icon";

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
      <h2 id={id ? `${id}-title` : undefined} className="px-1 text-[0.8125rem] font-semibold text-ink-3">
        {title}
      </h2>
      <div className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">
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
  // Rows pass their conditional panels as `{phase === "x" && <Panel/>}`;
  // when none applies those are all `false`, which must not leave an empty
  // spaced wrapper behind.
  const hasPanel = Children.toArray(children).length > 0;
  return (
    <div className="px-4 py-3.5">
      <div className="flex min-h-7 items-center justify-between gap-4">
        <div className="min-w-0 space-y-0.5">
          <LabelTag
            {...(htmlFor ? { htmlFor } : {})}
            className={`block text-base font-medium ${tone === "danger" ? "text-danger" : ""}`}
          >
            {label}
          </LabelTag>
          {description && <div className="text-[0.8125rem] leading-relaxed text-ink-3">{description}</div>}
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {hasPanel && <div className="mt-4">{children}</div>}
    </div>
  );
}

/** Row that navigates somewhere, with a chevron. */
export function SettingsLinkRow({ href, label, description }: { href: string; label: string; description?: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-14 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-fill focus:outline-none focus-visible:bg-fill"
    >
      <div className="space-y-0.5">
        <p className="text-base font-medium">{label}</p>
        {description && <p className="text-[0.8125rem] text-ink-3">{description}</p>}
      </div>
      <Icon name="chevron-right" size={18} strokeWidth={2} className="shrink-0 text-ink-4" />
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
      // Off is a neutral grey that doesn't draw the eye; on is ink. The
      // knob moves too, so the state never rests on colour alone.
      className={`relative inline-flex h-8 w-[3.25rem] shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-40 ${
        checked ? "bg-primary" : "bg-off"
      }`}
    >
      <span
        aria-hidden
        className={`inline-block h-[1.625rem] w-[1.625rem] rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.2)] transition-transform duration-200 ${
          checked ? "translate-x-[1.4375rem]" : "translate-x-[0.1875rem]"
        }`}
      />
    </button>
  );
}

/** Small inline "자세히" link into the help docs. */
export function MoreLink({ href }: { href: string }) {
  return (
    <Link href={href} className="whitespace-nowrap font-medium text-ink-2 underline underline-offset-4 hover:opacity-70">
      자세히
    </Link>
  );
}
