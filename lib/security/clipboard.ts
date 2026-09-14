/**
 * Clipboard auto-clear for one-time secret reveals (components/SecretCard.tsx
 * — recovery/Shamir backup codes). The clipboard is a real exfiltration
 * channel this app can't fully close by itself: any extension holding the
 * `clipboardRead` permission, or any other app on the same device polling
 * the system clipboard, can read whatever was copied for as long as it
 * stays there — no page-level code runs "in between" a copy and some other
 * program's read to stop it. What page-level code CAN do is shrink that
 * window: clear the clipboard again after a short delay, the same
 * mitigation password managers (1Password, Bitwarden, etc.) ship.
 *
 * This only clears clipboard content it can confirm is STILL the text it
 * wrote (via `readText()`) — never a blind overwrite — so a user who
 * copies something else in the meantime doesn't have that second thing
 * silently destroyed. `readText()` requires clipboard-read permission,
 * which browsers don't uniformly grant without a permission prompt of its
 * own; failing (or being unsupported) is treated as "can't confirm, so
 * don't touch it" rather than an error the caller needs to handle — the
 * copy itself already succeeded by the time this runs.
 */
const DEFAULT_CLEAR_AFTER_MS = 30_000;

export async function copyWithAutoClear(
  text: string,
  clearAfterMs: number = DEFAULT_CLEAR_AFTER_MS
): Promise<void> {
  await navigator.clipboard.writeText(text);

  setTimeout(() => {
    void (async () => {
      try {
        const current = await navigator.clipboard.readText();
        if (current === text) {
          await navigator.clipboard.writeText("");
        }
      } catch {
        // No clipboard-read permission, an unsupported browser, or the
        // tab lost focus (many browsers refuse clipboard access from a
        // background tab) — nothing this function can do about any of
        // those, and none of them should surface as an error to the
        // caller for what was already a successful copy.
      }
    })();
  }, clearAfterMs);
}

export { DEFAULT_CLEAR_AFTER_MS };
