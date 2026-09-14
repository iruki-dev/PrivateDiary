/**
 * Account-level preferences, split across two `users/{uid}` fields by how
 * much trust a write to them needs — mirroring firestore.rules exactly:
 *
 *   - `preferences` — purely cosmetic (privateWritingMode,
 *     privateWritingPeekAllowed; ARCHITECTURE.md §3.9). Writable without
 *     any reauthentication, same as it always was.
 *   - `security` — autoLockMinutes and draftAutosave. These decide how
 *     long an unlocked session stays readable and whether drafts touch
 *     disk in plaintext, so a write to them needs the same proof a
 *     credential-bearing field does: firestore.rules'
 *     credentialMutationAllowed() (a valid OTP session, or — for accounts
 *     without OTP — a real login within the last 5 minutes, not just a
 *     silently-refreshed token). Bundling them into `preferences` under
 *     one gate would have meant either loosening that gate back to
 *     "vacuously true for non-OTP accounts" (reopening the exact hole
 *     security-patch-v2/C1 closed for wrappedSeed/publicKeys/
 *     decryptionMethods) or dragging the cosmetic fields into a
 *     reauthentication requirement they don't need.
 *
 * Kept here, free of any Firebase import, so the shape, the defaults and
 * the validation are one auditable unit that firestore.rules mirrors and
 * that unit tests can exercise directly. lib/firebase/users.ts is what
 * actually routes a patch to the right Firestore field(s); this module
 * only knows the shape.
 */

export interface UserPreferences {
  /** Blur the /write textarea while typing (ARCHITECTURE.md §3.9). */
  privateWritingMode: boolean;
  /** Show the hold-to-reveal icon while private writing mode is on. */
  privateWritingPeekAllowed: boolean;
  /**
   * Minutes of inactivity before the unlocked master seed is wiped from
   * memory. 0 disables auto-lock.
   */
  autoLockMinutes: number;
  /**
   * Whether /write keeps an in-progress entry on the device so a crash or
   * an accidental tab close doesn't lose it. The draft is PLAINTEXT on
   * disk (lib/drafts.ts), which is why this defaults OFF: a feature that
   * writes the diary's contents to a device unencrypted has to be
   * something the owner turned on knowing that, never something they
   * inherited from a default.
   */
  draftAutosave: boolean;
  /**
   * PENTEST FINDING F-2: max `entries` documents this account can create
   * per rolling 24h window, enforced server-side by
   * functions/src/entryRateLimit.ts (a Firestore trigger using the Admin
   * SDK — the one thing that can delete an `entries` document after the
   * fact, bypassing append-only exactly like deleteAccount already does).
   * Firestore rules can only gate WHO may raise or disable (0) this value,
   * not the count itself — see firestore.rules' isValidSecurityPreferences.
   *
   * The default (DEFAULT_PREFERENCES below) is a real, enforced cap even
   * for an account that never visited this setting — unlike draftAutosave,
   * this protection has to apply to everyone by default, since the whole
   * point is bounding what a session-only attacker (who will never
   * voluntarily turn on a limit against themselves) can inject. 0 means no
   * limit, matching the "사용 안 함" convention autoLockMinutes already uses
   * — an explicit choice the account owner has to prove a master
   * credential to make (SECURITY_PREFERENCE_KEYS below).
   */
  dailyEntryLimit: number;
}

/** Keys stored under `users/{uid}.preferences` — ungated, cosmetic only. */
export const DISPLAY_PREFERENCE_KEYS = [
  "privateWritingMode",
  "privateWritingPeekAllowed",
] as const satisfies readonly (keyof UserPreferences)[];

/**
 * Keys stored under `users/{uid}.security` — gated by firestore.rules'
 * credentialMutationAllowed(), exactly like wrappedSeed/publicKeys/
 * decryptionMethods. lib/firebase/users.ts uses this to split a patch and
 * route each half through the right write path (only the security half
 * goes through runCredentialMutation).
 */
export const SECURITY_PREFERENCE_KEYS = [
  "autoLockMinutes",
  "draftAutosave",
  "dailyEntryLimit",
] as const satisfies readonly (keyof UserPreferences)[];

export const DEFAULT_PREFERENCES: UserPreferences = {
  privateWritingMode: false,
  privateWritingPeekAllowed: true,
  // 15 minutes: long enough to make coffee without re-entering a six-word
  // passphrase, short enough that a walked-away-from screen doesn't stay
  // readable all afternoon.
  autoLockMinutes: 15,
  draftAutosave: false,
  // 100/day: far past any real diary's normal use (even several entries a
  // day), while still bounding how much undeletable junk a session-only
  // attacker (PENTEST F-2) can inject into an append-only collection
  // before functions/src/entryRateLimit.ts starts deleting the excess.
  dailyEntryLimit: 100,
};

/**
 * The auto-lock values the UI offers. firestore.rules pins the stored
 * value to exactly this set — the same reasoning as the PBKDF2 iteration
 * floor there: a value the client would never produce has no business
 * being accepted, and an out-of-range one here would silently mean "never
 * lock".
 */
export const AUTO_LOCK_CHOICES: { minutes: number; label: string }[] = [
  { minutes: 1, label: "1분" },
  { minutes: 5, label: "5분" },
  { minutes: 15, label: "15분" },
  { minutes: 30, label: "30분" },
  { minutes: 60, label: "1시간" },
  { minutes: 0, label: "사용 안 함" },
];

export const AUTO_LOCK_MINUTE_VALUES: readonly number[] = AUTO_LOCK_CHOICES.map((c) => c.minutes);

/**
 * The dailyEntryLimit values the UI offers. firestore.rules pins the
 * stored value to exactly this set, same reasoning as AUTO_LOCK_CHOICES:
 * functions/src/entryRateLimit.ts reads this value straight back as an
 * enforcement decision, so a value this codebase would never produce must
 * not be storable. 0 is the explicit "사용 안 함" (unlimited) choice.
 */
export const DAILY_ENTRY_LIMIT_CHOICES: { limit: number; label: string }[] = [
  { limit: 10, label: "하루 10개" },
  { limit: 25, label: "하루 25개" },
  { limit: 50, label: "하루 50개" },
  { limit: 100, label: "하루 100개" },
  { limit: 200, label: "하루 200개" },
  { limit: 0, label: "제한 없음" },
];

export const DAILY_ENTRY_LIMIT_VALUES: readonly number[] = DAILY_ENTRY_LIMIT_CHOICES.map(
  (c) => c.limit
);

/**
 * Coerces whatever came back from Firestore into a complete, valid
 * preferences object.
 *
 * Every field is optional in storage (accounts predate each of them), and
 * a value that is missing, the wrong type, or outside the offered set
 * falls back to its default rather than being trusted. The rules reject
 * such a write in the first place; this is the client-side half of the
 * same check, so a document that somehow holds a bad value can't turn into
 * an effectively-disabled auto-lock at runtime.
 */
export function normalizePreferences(stored: unknown): UserPreferences {
  if (typeof stored !== "object" || stored === null) return DEFAULT_PREFERENCES;
  const record = stored as Record<string, unknown>;

  const bool = (key: keyof UserPreferences): boolean =>
    typeof record[key] === "boolean" ? (record[key] as boolean) : (DEFAULT_PREFERENCES[key] as boolean);

  const minutes = record.autoLockMinutes;
  const dailyLimit = record.dailyEntryLimit;

  return {
    privateWritingMode: bool("privateWritingMode"),
    privateWritingPeekAllowed: bool("privateWritingPeekAllowed"),
    autoLockMinutes:
      typeof minutes === "number" && AUTO_LOCK_MINUTE_VALUES.includes(minutes)
        ? minutes
        : DEFAULT_PREFERENCES.autoLockMinutes,
    draftAutosave: bool("draftAutosave"),
    dailyEntryLimit:
      typeof dailyLimit === "number" && DAILY_ENTRY_LIMIT_VALUES.includes(dailyLimit)
        ? dailyLimit
        : DEFAULT_PREFERENCES.dailyEntryLimit,
  };
}
