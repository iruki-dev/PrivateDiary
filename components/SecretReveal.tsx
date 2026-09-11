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
  confirmLabel = "저장했습니다",
  acknowledgeText = "안전한 곳에 보관했습니다. 이 화면은 다시 표시되지 않는다는 것을 이해했습니다.",
  confirming = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onConfirm: () => void;
  confirmLabel?: string;
  acknowledgeText?: string;
  /** True while onConfirm's action is in flight — disables the button to prevent double-submits. */
  confirming?: boolean;
}) {
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
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 muted">{description}</p>
      </div>

      {children}

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-foreground"
        />
        <span>{acknowledgeText}</span>
      </label>

      <button
        type="button"
        disabled={!acknowledged || confirming}
        onClick={onConfirm}
        className="btn-primary w-full"
      >
        {confirmLabel}
      </button>
    </div>
  );
}
