/** Minimal monochrome spinner in the current text colour. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="presentation"
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60 ${className}`}
    />
  );
}
