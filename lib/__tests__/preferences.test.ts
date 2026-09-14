import { describe, expect, it } from "vitest";
import {
  AUTO_LOCK_CHOICES,
  AUTO_LOCK_MINUTE_VALUES,
  DEFAULT_PREFERENCES,
  DISPLAY_PREFERENCE_KEYS,
  SECURITY_PREFERENCE_KEYS,
  normalizePreferences,
  type UserPreferences,
} from "../preferences";

describe("defaults", () => {
  it("auto-locks out of the box — the app must not stay unlocked forever by default", () => {
    expect(DEFAULT_PREFERENCES.autoLockMinutes).toBeGreaterThan(0);
  });

  it("keeps draft autosave OFF by default — it is the one thing that writes plaintext to disk", () => {
    expect(DEFAULT_PREFERENCES.draftAutosave).toBe(false);
  });

  it("offers the default auto-lock value as one of the choices", () => {
    expect(AUTO_LOCK_MINUTE_VALUES).toContain(DEFAULT_PREFERENCES.autoLockMinutes);
  });

  it("offers an explicit never option", () => {
    expect(AUTO_LOCK_CHOICES.some((choice) => choice.minutes === 0)).toBe(true);
  });
});

describe("normalizePreferences", () => {
  it("returns the defaults for a missing or non-object value", () => {
    expect(normalizePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences("nope")).toEqual(DEFAULT_PREFERENCES);
  });

  it("fills in fields an older account never stored", () => {
    // Accounts predate autoLockMinutes/draftAutosave entirely.
    expect(normalizePreferences({ privateWritingMode: true })).toEqual({
      ...DEFAULT_PREFERENCES,
      privateWritingMode: true,
    });
  });

  it("keeps every valid stored value", () => {
    const stored = {
      privateWritingMode: true,
      privateWritingPeekAllowed: false,
      autoLockMinutes: 1,
      draftAutosave: true,
    };
    expect(normalizePreferences(stored)).toEqual(stored);
  });

  it("accepts 0 (never auto-lock) as a real choice, not as junk", () => {
    expect(normalizePreferences({ autoLockMinutes: 0 }).autoLockMinutes).toBe(0);
  });

  it("refuses an auto-lock value outside the offered set", () => {
    // firestore.rules rejects such a write; this is the client-side half of
    // the same check, so a document that somehow holds one can't turn into
    // an effectively-disabled auto-lock at runtime.
    for (const bad of [100000, 7, -1, Number.NaN, Number.POSITIVE_INFINITY, "15", null]) {
      expect(normalizePreferences({ autoLockMinutes: bad }).autoLockMinutes).toBe(
        DEFAULT_PREFERENCES.autoLockMinutes
      );
    }
  });

  it("refuses wrongly-typed booleans", () => {
    const result = normalizePreferences({
      privateWritingMode: "yes",
      privateWritingPeekAllowed: 1,
      draftAutosave: "true",
    });
    expect(result.privateWritingMode).toBe(DEFAULT_PREFERENCES.privateWritingMode);
    expect(result.privateWritingPeekAllowed).toBe(DEFAULT_PREFERENCES.privateWritingPeekAllowed);
    expect(result.draftAutosave).toBe(DEFAULT_PREFERENCES.draftAutosave);
  });

  it("drops unknown keys rather than passing them through to Firestore", () => {
    expect(normalizePreferences({ somethingElse: true })).toEqual(DEFAULT_PREFERENCES);
  });
});

describe("DISPLAY_PREFERENCE_KEYS / SECURITY_PREFERENCE_KEYS", () => {
  // lib/firebase/users.ts routes a preferences patch to the right
  // Firestore field (ungated `preferences` vs. credentialMutationAllowed()
  // -gated `security`) purely by checking which of these two lists a key
  // is in. If a key ever fell into neither or both, a write to it would
  // silently go to the wrong field — or nowhere.
  const allKeys: (keyof UserPreferences)[] = [
    "privateWritingMode",
    "privateWritingPeekAllowed",
    "autoLockMinutes",
    "draftAutosave",
  ];

  it("together cover every UserPreferences key exactly once", () => {
    const combined = [...DISPLAY_PREFERENCE_KEYS, ...SECURITY_PREFERENCE_KEYS];
    expect(combined.sort()).toEqual([...allKeys].sort());
    expect(new Set(combined).size).toBe(combined.length);
  });

  it("puts the two exposure controls, and only those, in the security list", () => {
    expect([...SECURITY_PREFERENCE_KEYS].sort()).toEqual(["autoLockMinutes", "draftAutosave"]);
  });
});
