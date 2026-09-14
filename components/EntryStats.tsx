import type { EntryDateStats } from "@/lib/entries/calendar";

/**
 * Writing statistics, all derived from entry timestamps alone
 * (lib/entries/calendar.ts) — so they are accurate before any ciphertext
 * has been opened, and they reveal nothing the server did not already
 * store in the clear.
 *
 * Deliberately understated: a diary is not a productivity tool, and the
 * app's monochrome palette has no room for a scoreboard. The streak is
 * here because showing up is the hard part of keeping a diary, not to
 * pressure anyone about it — which is also why a broken streak is shown as
 * a plain dash rather than a zero.
 */
export function EntryStats({ stats }: { stats: EntryDateStats }) {
  const rows: { label: string; value: string }[] = [
    { label: "전체", value: `${stats.total.toLocaleString("ko-KR")}개` },
    { label: "이번 달", value: `${stats.thisMonth.toLocaleString("ko-KR")}개` },
    { label: "기록한 날", value: `${stats.daysWritten.toLocaleString("ko-KR")}일` },
    {
      label: "연속 기록",
      value: stats.streak.current > 0 ? `${stats.streak.current}일` : "—",
    },
    { label: "최장 연속", value: `${stats.streak.longest}일` },
  ];

  return (
    <dl className="card grid grid-cols-2 gap-x-4 gap-y-2 lg:grid-cols-1">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-2">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">{row.label}</dt>
          <dd className="text-xs font-medium tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
