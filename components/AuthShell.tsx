import type { ReactNode } from "react";

/**
 * Shared frame for the signed-out account screens (login, signup): the
 * same centred narrow column and heading those pages already used, kept in
 * one place so they stay one family.
 */
export function AuthShell({
  title,
  lead,
  step,
  children,
  after,
}: {
  title: string;
  lead?: ReactNode;
  /** Signup's place in its three steps, shown as a progress bar above the title. */
  step?: 1 | 2 | 3;
  children: ReactNode;
  /** Below the card: other ways in (the Android app's on-phone diaries). */
  after?: ReactNode;
}) {
  return (
    // Top-aligned rather than .page-center: the signup steps swap content
    // of different heights, and a vertically centred form jumps to a new
    // position on every step on a phone.
    <main className="flex flex-1 flex-col items-center px-5 pb-10 pt-6 sm:px-6 sm:py-16">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 px-1">
          {step && <StepProgress step={step} />}
          <h1 className="title-1">{title}</h1>
          {lead && <div className="muted text-base">{lead}</div>}
        </div>
        {/* Fields sit on a white card: the --fill input colour needs the
            lighter surface around it to read as a field. */}
        <div className="space-y-5 rounded-3xl bg-surface p-5 sm:p-6">{children}</div>
        {after}
      </div>
    </main>
  );
}

/** "계정 → 일기 암호 → 백업 코드": three segments, the current and done ones in ink. */
export function StepProgress({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-2 pb-2">
      <div
        role="progressbar"
        aria-label="가입 단계"
        aria-valuemin={1}
        aria-valuemax={3}
        aria-valuenow={step}
        className="grid flex-1 grid-cols-3 gap-1"
      >
        {[1, 2, 3].map((i) => (
          <span key={i} className={`h-1 rounded-full ${i <= step ? "bg-ink" : "bg-pill"}`} />
        ))}
      </div>
      <span className="text-[0.8125rem] font-semibold text-ink-3 tabular-nums">{step}/3</span>
    </div>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-sm text-ink-3">
      <div className="h-px flex-1 bg-line" />
      또는
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}
