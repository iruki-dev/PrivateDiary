/**
 * Keeps an in-progress /write entry on THIS device so a crash, an
 * accidental tab close, or a misfired back gesture doesn't destroy it.
 *
 * The honest tradeoff, stated plainly because this app is otherwise very
 * careful about it: a draft is PLAINTEXT in localStorage. Nothing about
 * ARCHITECTURE.md §1.1 changes — the server still never sees plaintext,
 * and §1.3 already puts the local device outside the threat model — but
 * before this the app wrote nothing to disk at all, and that is a real
 * difference for anyone whose actual concern is someone else using their
 * machine. So it is:
 *
 *   - OFF by default and opt-in per account (lib/preferences.ts), so it is
 *     never something someone inherits without having chosen it,
 *   - scoped per uid, so signing in as someone else never surfaces it,
 *   - cleared the instant the entry is saved, and on sign-out,
 *   - visible in the UI whenever one exists, with a discard button —
 *     never a silent cache.
 *
 * The alternative — encrypting the draft to the account's own public keys,
 * which the write path already has (§3.2) — is self-defeating: reading it
 * back would need the seed unlocked, which is exactly what the write path
 * is designed not to require.
 */

const KEY_PREFIX = "privatediary:draft:v1:";

export interface StoredDraft {
  text: string;
  savedAt: Date;
}

function keyFor(uid: string): string {
  return `${KEY_PREFIX}${uid}`;
}

export function saveDraft(uid: string, text: string): void {
  try {
    if (!text.trim()) {
      window.localStorage.removeItem(keyFor(uid));
      return;
    }
    window.localStorage.setItem(
      keyFor(uid),
      JSON.stringify({ text, savedAt: new Date().toISOString() })
    );
  } catch {
    // Storage full or blocked — the in-memory textarea is unaffected, so
    // the user loses only the crash-safety net, silently and harmlessly.
  }
}

export function loadDraft(uid: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(keyFor(uid));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.text !== "string" || !record.text.trim()) return null;
    const savedAt = typeof record.savedAt === "string" ? new Date(record.savedAt) : new Date(NaN);
    return { text: record.text, savedAt: Number.isNaN(savedAt.getTime()) ? new Date() : savedAt };
  } catch {
    return null;
  }
}

export function clearDraft(uid: string): void {
  try {
    window.localStorage.removeItem(keyFor(uid));
  } catch {
    // Nothing to do — a draft we can't remove is one we also couldn't read.
  }
}

/**
 * Drops every account's draft on this device. Called on sign-out: leaving a
 * previous user's half-written entry sitting in storage on a shared machine
 * is precisely the exposure this module is supposed to bound.
 */
export function clearAllDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Same as above.
  }
}
