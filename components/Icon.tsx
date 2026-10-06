import type { ReactNode, SVGProps } from "react";

/**
 * The app's one icon set: a 24px grid, 1.75 stroke, round caps and joins.
 * No icon library — these are the only glyphs the app needs, drawn to one
 * spec instead of each screen hand-rolling its own stroke width.
 *
 * Outline everywhere; the filled variants (`*-fill`) exist only for the
 * selected tab, which is how the platforms mark the current place (Apple
 * HIG prefers filled tab symbols; M3 pairs them with a pill indicator).
 *
 * Decorative by default (aria-hidden). An icon-only button names itself
 * with its own aria-label, not through the icon.
 */

const GEAR =
  "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z";
const PEN = "M15.2 4.4a2.6 2.6 0 0 1 3.7 3.7L8.6 18.4 4 19.9l1.5-4.6L15.2 4.4Z";
const BOOK = "M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z";
const LOCK_BODY = "M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z";
const RING = "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z";

const OUTLINE = {
  pen: (
    <>
      <path d={PEN} />
      <path d="M13.5 6.1l4.4 4.4" />
    </>
  ),
  book: (
    <>
      <path d={BOOK} />
      <path d="M9 3v18M12.5 8h3" />
    </>
  ),
  gear: (
    <>
      <path d={GEAR} />
      <path d={RING} />
    </>
  ),
  lock: (
    <>
      <path d={LOCK_BODY} />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  search: (
    <>
      <path d="M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  calendar: (
    <>
      <path d="M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4v4h4M12 8v4l2.8 1.8" />
    </>
  ),
  clock: (
    <>
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  fingerprint: (
    <path d="M7.5 20.5c-.4-2.1-.4-4 0-6M12 21c-.6-3-.8-6.3 0-9M16.5 19.5c.4-2 .4-4.5 0-7.5a4.6 4.6 0 0 0-9 0M5 17c-.6-2.4-.6-4.8 0-7a7.4 7.4 0 0 1 14 0c.3 1 .4 2 .5 3" />
  ),
  key: (
    <>
      <path d="M12 15a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
      <path d="M11 12l9-9M17 6l3 3M14.5 8.5l2 2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  "shield-alert": (
    <>
      <path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Z" />
      <path d="M12 9v4M12 16h.01" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
      <path d={RING} />
    </>
  ),
  "eye-off": (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.4 9.4 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3 3.6" />
      <path d="M6.6 6.6A16 16 0 0 0 2.5 12s3.5 6 9.5 6a9.4 9.4 0 0 0 4.3-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  "check-circle": (
    <>
      <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      <path d="m8 12.5 2.7 2.7L16 10" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.3 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4M12 17h.01" />
    </>
  ),
  "alert-circle": (
    <>
      <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      <path d="M12 7.5v5M12 16h.01" />
    </>
  ),
  info: (
    <>
      <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  copy: (
    <>
      <path d="M10 8h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <path d="M15 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  "chevron-left": <path d="M15 18l-6-6 6-6" />,
  "chevron-right": <path d="M9 18l6-6-6-6" />,
  sort: <path d="M8 4v16M4 16l4 4 4-4M16 20V4M12 8l4-4 4 4" />,
  user: (
    <>
      <path d="M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  help: (
    <>
      <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      <path d="M9.6 9.2a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2.2-2.4 3.6M12 17h.01" />
    </>
  ),
  "log-out": <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />,
} satisfies Record<string, ReactNode>;

/** Filled shapes: the selected tab only. Cut-outs use the pill colour behind them. */
const FILLED = {
  "pen-fill": <path d={PEN} />,
  "book-fill": <path d={BOOK} />,
  "gear-fill": (
    <>
      <path d={GEAR} />
      <path d={RING} fill="var(--pill)" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof OUTLINE | keyof typeof FILLED;

export function Icon({
  name,
  size = 24,
  strokeWidth = 1.75,
  className,
  ...rest
}: { name: IconName; size?: number; strokeWidth?: number; className?: string } & Omit<
  SVGProps<SVGSVGElement>,
  "name"
>) {
  const filled = name in FILLED;
  const shape = filled ? FILLED[name as keyof typeof FILLED] : OUTLINE[name as keyof typeof OUTLINE];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
      {...rest}
    >
      {shape}
    </svg>
  );
}
