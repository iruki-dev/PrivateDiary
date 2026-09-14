/**
 * PENTEST FINDING F-2: bounds how many `entries` documents a single
 * account can accumulate per rolling 24h window, split out from index.ts
 * (like authFreshness.ts) so the actual counting/threshold decision is
 * unit-testable without booting firebase-admin or the emulator.
 *
 * WHY THIS EXISTS. `entries` is append-only by design (ARCHITECTURE.md
 * §5) — `allow update, delete: if false` — and `entries/{entryId}`
 * CREATE only checks shape + `uid` ownership (firestore.rules'
 * isValidEntry()), not `otpSatisfied()` or any other credential gate,
 * because writing a diary entry has to work from a locked session on any
 * device (§3.2 rule 5). That combination means a session-only attacker —
 * a stolen/hijacked ID token, no passphrase, no Shamir shares, no OTP —
 * can create an unbounded number of junk `entries` documents that neither
 * the attacker NOR the real account owner can ever remove (verified
 * against the real Firestore rules emulator during this pentest: every
 * `create` succeeded, every `update`/`delete` on the injected documents
 * failed). Each one also either shows up as a permanent "tampered" card
 * (garbage ciphertext) or, worse, as an XSS-forged entry that decrypts
 * cleanly to whatever the attacker wrote (the attacker only needs the
 * victim's PUBLIC keys, which `users/{uid}` already exposes to a
 * session-only reader of that account).
 *
 * WHY FIRESTORE RULES ALONE CAN'T FIX THIS. The natural rule would be
 * "reject a create once this account already has N entries today" — but
 * rules evaluate each document write independently and have no construct
 * for "this create is only valid if some OTHER document (a counter) is
 * simultaneously, atomically incremented by exactly one as part of the
 * same request" — an attacker's client can simply omit that second write
 * and the rule has nothing left to check against. (This is the same
 * structural limit `lastEntrySeq` already lives with — see
 * firestore.rules' isValidLastEntrySeqStep() doc comment for the
 * PENTEST F-1 finding that came from relying on an ungated client-paired
 * write for a DIFFERENT invariant.)
 *
 * THE FIX. A Firestore trigger (index.ts's enforceEntryRateLimit, wired to
 * onDocumentCreated("entries/{entryId}")) runs with the Admin SDK after
 * every entry is committed, atomically bumping a per-account counter
 * (`entryRateLimits/{uid}` — deny-all to every client, exactly like
 * `otpSecrets/{uid}`) inside a transaction, and — if that push takes the
 * account over its own configured `users/{uid}.security.dailyEntryLimit`
 * — deletes the entry that pushed it over. This is the same "Admin SDK is
 * the one thing that can undo append-only" pattern deleteAccount already
 * relies on (see that function's doc comment), here scoped to just the
 * documents that exceed the account's own limit rather than the whole
 * collection. `dailyEntryLimit` itself is changeable only by someone who
 * has already proven a master credential (firestore.rules'
 * credentialMutationAllowed(), same gate as autoLockMinutes/
 * draftAutosave) — otherwise a session-only attacker bent on this exact
 * attack could just raise (or disable, via 0) their own limit first.
 *
 * WHAT THIS DOES NOT CLAIM TO BE: a precise, race-proof "exactly N per
 * calendar day" limiter — it's a ROLLING 24h window (simpler to compute
 * correctly with Firestore Timestamps, no locale/timezone-dependent
 * "midnight" boundary to get wrong), and it runs asynchronously after the
 * write commits (a trigger, not something that can block the original
 * create) — so a small, brief overshoot past the configured limit before
 * cleanup catches up is expected and accepted. The point is bounding
 * VOLUME over time, not enforcing a hard synchronous quota; for THIS
 * threat (unbounded, permanent injection), a same-order-of-magnitude cap
 * that closes itself within moments is what actually matters.
 */

export const DEFAULT_DAILY_ENTRY_LIMIT = 100;
export const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h, rolling — see module doc.

export interface RateLimitCounterState {
  /** Millis since epoch when the current rolling window started. */
  windowStartMs: number;
  /** Entries counted (created — whether or not later deleted for exceeding the limit) within the current window. */
  count: number;
}

export interface RateLimitDecision {
  /** The counter state to persist to entryRateLimits/{uid}. */
  next: RateLimitCounterState;
  /** True if this entry pushed the account's count for the current window over its effective limit. */
  overLimit: boolean;
}

/**
 * Pure decision function — no Firestore/Admin SDK imports, so this is
 * exercised directly by entryRateLimit.test.ts without an emulator.
 *
 * `effectiveLimit <= 0` means "unlimited" (mirrors autoLockMinutes'/
 * dailyEntryLimit's UI convention: 0 is the explicit "사용 안 함" choice —
 * lib/preferences.ts's DAILY_ENTRY_LIMIT_CHOICES) — always returns
 * `overLimit: false` in that case, still tracking the count so the window
 * behaves consistently if the owner lowers the limit again later.
 */
export function decideRateLimit(
  previous: RateLimitCounterState | null,
  nowMs: number,
  effectiveLimit: number
): RateLimitDecision {
  const windowExpired =
    previous === null || nowMs - previous.windowStartMs >= RATE_LIMIT_WINDOW_MS;

  const next: RateLimitCounterState = windowExpired
    ? { windowStartMs: nowMs, count: 1 }
    : { windowStartMs: previous.windowStartMs, count: previous.count + 1 };

  const overLimit = effectiveLimit > 0 && next.count > effectiveLimit;

  return { next, overLimit };
}

/** `security.dailyEntryLimit` as actually stored may be missing (account predates the field), the wrong type, or outside the offered set (a tampered/rolled-back write) — never trust it blindly. Falls back to DEFAULT_DAILY_ENTRY_LIMIT, same "don't trust an out-of-range stored value" rule lib/preferences.ts's normalizePreferences already follows client-side. */
export function resolveDailyEntryLimit(stored: unknown): number {
  if (typeof stored !== "number" || !Number.isFinite(stored) || stored < 0) {
    return DEFAULT_DAILY_ENTRY_LIMIT;
  }
  return stored;
}
