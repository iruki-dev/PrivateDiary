/** Outline fingerprint, drawn to match the tab bar's 1.6–1.8px stroke icons. */
export function FingerprintIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M6.5 6.2A8 8 0 0 1 20 12v1" />
      <path d="M4 10.2a8 8 0 0 0-.1 1.8v1.5" />
      <path d="M8.3 20.4A12 12 0 0 1 7 13.5V12a5 5 0 0 1 10 0v1.6" />
      <path d="M12 12v1.5c0 2.8.9 5.4 2.4 7.4" />
      <path d="M16.9 16.4c.2 1.4.6 2.7 1.2 3.9" />
    </svg>
  );
}
