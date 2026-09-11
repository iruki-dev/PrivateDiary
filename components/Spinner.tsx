/** Minimal monochrome spinner — matches the app's plain-text/border design language, no icon set involved. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="presentation"
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60 ${className}`}
    />
  );
}
