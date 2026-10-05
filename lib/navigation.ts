/**
 * Where a signed-in user lands when nothing more specific was asked for —
 * the daily dashboard, not the public landing page at "/".
 */
export const DEFAULT_SIGNED_IN_PATH = "/home";

/**
 * Validates the `?next=` value /login carries back to the page a signed-out
 * visitor originally asked for. Only same-origin absolute paths pass:
 * anything else (an absolute URL, a protocol-relative "//evil.example", a
 * backslash variant browsers normalise to the same thing) would turn the
 * login form into an open redirect — a phishing page could link to
 * /login?next=https://lookalike and have this app itself send a freshly
 * signed-in user there.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_SIGNED_IN_PATH;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return DEFAULT_SIGNED_IN_PATH;
  }
  // Control characters (tab/newline) are stripped by the URL parser, which
  // can resurrect a "//" prefix after the check above.
  if (/[\u0000-\u001f\\]/.test(raw)) return DEFAULT_SIGNED_IN_PATH;
  return raw;
}

/** Builds the login URL that brings the visitor back to `path` afterwards. */
export function loginPathFor(path: string): string {
  const next = safeNextPath(path);
  return next === DEFAULT_SIGNED_IN_PATH ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}
