import { Spinner } from "./Spinner";

/**
 * Inline spinner + label, for embedding inside already-rendered content
 * (e.g. OtpGate). An empty label shows the spinner alone and still tells
 * screen readers what is happening.
 */
export function LoadingState({ label = "확인하는 중…" }: { label?: string }) {
  return (
    <p role="status" className="muted flex items-center justify-center gap-2">
      <Spinner />
      {label || <span className="sr-only">불러오는 중</span>}
    </p>
  );
}

/** Full-page loading placeholder — the standard "checking auth/seed state" screen used across every route. */
export function LoadingScreen({ label }: { label?: string }) {
  return (
    <main className="page-center">
      <LoadingState label={label} />
    </main>
  );
}
