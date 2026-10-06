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
export function TodayLabel({ className, weekdayClassName }: { className?: string; weekdayClassName?: string }) {
  const label = useSyncExternalStore(
    subscribe,
    () => formatter.format(new Date()),
    () => ""
  );
  // "10월 6일 화요일": the date is the headline, the weekday can step back.
  const split = weekdayClassName ? label.lastIndexOf(" ") : -1;
  if (split > 0) {
    return (
      <span className={className}>
        {label.slice(0, split)} <span className={weekdayClassName}>{label.slice(split + 1)}</span>
      </span>
    );
  }
  // A non-breaking space keeps the line's height before the date is known.
  return <span className={className}>{label || "\u00a0"}</span>;
}
