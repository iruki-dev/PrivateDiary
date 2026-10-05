"use client";

import { useSyncExternalStore } from "react";

const formatter = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  weekday: "long",
});

function subscribe(onChange: () => void) {
  // Re-read once a minute so a page left open past midnight rolls over.
  const timer = setInterval(onChange, 60_000);
  return () => clearInterval(timer);
}

/**
 * Today's date in the visitor's own time zone ("10월 5일 월요일"). Empty
 * on the server — the server's clock and zone aren't the reader's, and
 * rendering one date there and another after hydration would mismatch.
 */
export function TodayLabel({ className }: { className?: string }) {
  const label = useSyncExternalStore(
    subscribe,
    () => formatter.format(new Date()),
    () => ""
  );
  return <span className={className}>{label || " "}</span>;
}
