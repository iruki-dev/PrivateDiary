import { Icon } from "./Icon";

const sinceFormatter = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" });
const lastFormatter = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" });

/**
 * The locked diary, drawn as a closed notebook: a dark cover with a spine
 * and a clasp. It is the one heavy, dark object in an otherwise light app,
 * which is what makes "locked" readable at a glance.
 *
 * Everything on it — how many entries, when the first and the latest were
 * written — comes from `createdAt` and the entry count, which Firestore
 * holds in the clear anyway (see lib/entries/calendar.ts). Nothing here
 * needs the diary opened.
 */
export function DiaryCover({
  total,
  first,
  last,
  compact = false,
}: {
  total: number;
  first: Date | null;
  last: Date | null;
  compact?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-[1.75rem] bg-cover text-on-cover shadow-[0_24px_48px_rgb(0_0_0/0.18),0_2px_6px_rgb(0_0_0/0.12)] transition-[height] duration-200 ${
        compact ? "h-40" : "h-64"
      }`}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[18px] bg-black/35" />
      <span aria-hidden className="absolute inset-y-0 left-[18px] w-px bg-white/10" />
      <span
        aria-hidden
        className="absolute right-0 top-7 flex h-14 w-16 items-center justify-center rounded-l-2xl bg-[#2b2b2b] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]"
      >
        <Icon name="lock" size={24} />
      </span>
      {first && (
        <p className="absolute left-11 top-6 text-[0.8125rem] font-semibold opacity-60">
          {sinceFormatter.format(first)}부터
        </p>
      )}
      <p className="absolute bottom-12 left-11 flex items-baseline gap-1.5">
        <span
          className={`font-extrabold leading-none tracking-[-0.04em] tabular-nums ${compact ? "text-[2.75rem]" : "text-[4rem]"}`}
        >
          {total.toLocaleString("ko-KR")}
        </span>
        <span className="text-[1.0625rem] font-semibold opacity-80">개의 일기</span>
      </p>
      {last && (
        <p className="absolute bottom-6 left-11 text-[0.8125rem] font-medium opacity-60">
          마지막으로 쓴 날 {lastFormatter.format(last)}
        </p>
      )}
    </div>
  );
}
