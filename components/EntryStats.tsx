import type { EntryDateStats } from "@/lib/entries/calendar";

/**
 * What has been written, from entry timestamps alone (lib/entries/calendar.ts)
 * — so it is accurate before any ciphertext has been opened, and it
 * reveals nothing the server did not already store in the clear.
 *
 * Only what has accumulated, never what was missed: no streak. Streaks
 * turn a skipped day into a loss, and in journaling apps that guilt is a
 * common reason people stop writing altogether; a single missed day makes
 * no measurable difference to forming the habit. (lib/entries/calendar.ts
 * still computes the streak; this view chooses not to show it.)
 */
export function EntryStats({ stats }: { stats: EntryDateStats }) {
  const rows: { label: string; value: string; unit: string }[] = [
    { label: "일기", value: stats.total.toLocaleString("ko-KR"), unit: "개" },
    { label: "쓴 날", value: stats.daysWritten.toLocaleString("ko-KR"), unit: "일" },
    { label: "이번 달", value: stats.thisMonth.toLocaleString("ko-KR"), unit: "개" },
  ];

  return (
    <dl className="grid grid-cols-3 rounded-2xl bg-surface px-1 py-4">
      {rows.map((row, index) => (
        <div key={row.label} className={`flex flex-col gap-1 px-4 ${index ? "border-l border-line" : ""}`}>
          <dt className="text-[0.8125rem] font-semibold text-ink-3">{row.label}</dt>
          <dd className="text-[1.375rem] leading-none font-extrabold tracking-[-0.02em] tabular-nums">
            {row.value}
            <span className="ml-0.5 text-sm font-semibold text-ink-3">{row.unit}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
