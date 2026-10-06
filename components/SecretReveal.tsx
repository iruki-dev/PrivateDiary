"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Generic "show this secret exactly once" scaffold — used for the
 * recovery-key and Shamir-share reveal screens (previously
 * MnemonicReveal, generalized when the mnemonic was removed in favor of
 * opt-in recovery methods). Never persists anything itself: the secret
 * lives only in the caller's React state, so a refresh or back navigation
 * destroys it by construction. The beforeunload prompt is a courtesy
 * against losing it by accident before it's acknowledged.
 */
export function SecretReveal({
  title,
  description,
  children,
  onConfirm,
  confirmLabel = "다 적었어요",
  acknowledgeText = "백업 코드를 안전한 곳에 적어 두었어요",
  confirming = false,
  headingLevel = 1,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onConfirm: () => void;
  confirmLabel?: string;
  acknowledgeText?: string;
  /** True while onConfirm's action is in flight — disables the button to prevent double-submits. */
  confirming?: boolean;
  /** 1 when this is the page itself (signup); 3 when it opens inside a /settings row. */
  headingLevel?: 1 | 3;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h3";
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return (
    <div className="w-full max-w-lg space-y-6">
      <div>
        <Heading className={headingLevel === 1 ? "title-1" : "text-[1.0625rem] font-bold"}>{title}</Heading>
        <p className={`mt-2 muted ${headingLevel === 1 ? "text-base" : ""}`}>{description}</p>
      </div>

      {children}

      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[0.9375rem] font-semibold">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="h-6 w-6 shrink-0 accent-[var(--primary)]"
        />
        <span>{acknowledgeText}</span>
      </label>

      <button
        type="button"
        disabled={!acknowledged || confirming}
        onClick={onConfirm}
        className="btn-primary min-h-14 w-full rounded-2xl text-[1.0625rem]"
      >
        {confirmLabel}
      </button>
    </div>
  );
}
