"use client";

import { useEffect, type ReactNode } from "react";
import { Icon } from "@/components/Icon";

/**
 * A short confirmation that floats above the tab bar — "일기를 저장했어요"
 * — with at most one follow-up action. It reports something that already
 * happened, so it never asks for a decision and goes away by itself.
 *
 * role="status" (polite) so screen readers hear it without it stealing
 * focus from the editor the person is still typing in.
 */
export function Toast({
  message,
  action,
  onDismiss,
  duration = 4000,
}: {
  message: string;
  action?: ReactNode;
  onDismiss: () => void;
  duration?: number;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [onDismiss, duration]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 sm:bottom-6"
    >
      <div
        role="status"
        className="pointer-events-auto flex min-h-14 w-full max-w-md items-center gap-3 rounded-2xl bg-primary py-1.5 pl-4 pr-1.5 text-on-primary shadow-float"
      >
        <Icon name="check-circle" size={22} className="shrink-0" />
        <p className="flex-1 text-[0.9375rem] font-semibold">{message}</p>
        {action}
      </div>
    </div>
  );
}
