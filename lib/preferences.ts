/**
 * Account-level preferences stored at `users/{uid}.preferences`.
 *
 * Kept here, free of any Firebase import, so the shape, the defaults and
 * the validation are one auditable unit that firestore.rules mirrors and
 * that unit tests can exercise directly.
 *
 * NOTE ON SCOPE (this changed deliberately): these used to be purely
 * display settings, which is why ARCHITECTURE.md §3.9 and firestore.rules
 * both described `preferences` as carrying no security weight, and why the
 * rules let them move without satisfying the OTP gate. `autoLockMinutes`
 * is a security control, so that exemption no longer holds and was
 * removed — changing any preference now requires otpSatisfied() exactly
 * like a credential-bearing field. Without that change, someone holding
 * nothing but a stolen session could silently switch a victim's auto-lock
 * off and wait for physical access to an unlocked screen.
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
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  privateWritingMode: false,
  privateWritingPeekAllowed: true,
  // 15 minutes: long enough to make coffee without re-entering a six-word
  // passphrase, short enough that a walked-away-from screen doesn't stay
  // readable all afternoon.
  autoLockMinutes: 15,
  draftAutosave: false,
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

  return {
    privateWritingMode: bool("privateWritingMode"),
    privateWritingPeekAllowed: bool("privateWritingPeekAllowed"),
    autoLockMinutes:
      typeof minutes === "number" && AUTO_LOCK_MINUTE_VALUES.includes(minutes)
        ? minutes
        : DEFAULT_PREFERENCES.autoLockMinutes,
    draftAutosave: bool("draftAutosave"),
  };
}
