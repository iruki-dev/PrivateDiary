"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { getUserPreferences, setUserPreferences } from "@/lib/firebase/users";
import { DEFAULT_PREFERENCES, type UserPreferences } from "@/lib/preferences";

/**
 * Account-level preferences (users/{uid}.preferences) — how /write behaves
 * while typing, how long an unlocked session survives, whether drafts are
 * kept on the device. All of them follow the account across devices.
 *
 * Kept as its own context rather than folded into SeedContext because it
 * has nothing to do with the master seed/keys — just like OtpContext, it
 * only needs to know who's signed in (AuthContext). SeedContext sits
 * BELOW this provider precisely so it can read autoLockMinutes from here
 * (contexts/Providers.tsx).
 *
 * While the fetch is in flight, `loading` is true and the values are the
 * defaults — which is the safe reading for every one of them (auto-lock
 * on, drafts off, blur off but /write waits on `loading` before
 * rendering). Nothing here should ever fail open.
 */

interface PreferencesContextValue extends UserPreferences {
  loading: boolean;
  setPrivateWritingMode: (value: boolean) => Promise<void>;
  setPrivateWritingPeekAllowed: (value: boolean) => Promise<void>;
  setAutoLockMinutes: (value: number) => Promise<void>;
  setDraftAutosave: (value: boolean) => Promise<void>;
  /** PENTEST FINDING F-2: caps `entries` created per rolling 24h window (functions/src/entryRateLimit.ts). Same reauth requirement as setAutoLockMinutes. */
  setDailyEntryLimit: (value: number) => Promise<void>;
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { user, status: authStatus } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  // Guards against a slow fetch for a since-signed-out (or switched)
  // user overwriting state after the fact — same shape as SeedContext's
  // stale-async-write guards.
  const requestUidRef = useRef<string | null>(null);

  useEffect(() => {
    if (authStatus === "signed-in" && user) {
      requestUidRef.current = user.uid;
      // getUserPreferences reads Firestore (browser-only, async) — this
      // can't be reduced to state derived purely from props during render
      // (same shape as SeedContext's refresh()).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(true);
      getUserPreferences(user.uid)
        .then((prefs) => {
          if (requestUidRef.current === user.uid) setPreferences(prefs);
        })
        .catch((err) => {
          console.error("getUserPreferences failed", err);
        })
        .finally(() => {
          if (requestUidRef.current === user.uid) setLoading(false);
        });
    } else if (authStatus === "signed-out") {
      requestUidRef.current = null;
      setPreferences(DEFAULT_PREFERENCES);
      setLoading(false);
    }
    // "loading" leaves preferences state as-is until auth resolves.
  }, [authStatus, user]);

  const update = useCallback(
    async (patch: Partial<UserPreferences>) => {
      if (!user) return;
      const previous = preferences;
      setPreferences((prev) => ({ ...prev, ...patch }));
      try {
        await setUserPreferences(user.uid, patch);
      } catch (err) {
        console.error("setUserPreferences failed", err);
        setPreferences(previous);
        // Rethrown (not just logged) so a caller writing a security-
        // relevant field (lib/preferences.ts's SECURITY_PREFERENCE_KEYS —
        // gated by firestore.rules' credentialMutationAllowed()) can tell
        // a real failure, e.g. ReauthRequiredError on a non-OTP account
        // whose session isn't recent enough, from success and say so
        // (app/settings/page.tsx's SessionSection). Callers that don't
        // care (the purely cosmetic setters) can just ignore the
        // rejection — `void setX(...)`, same as before.
        throw err;
      }
    },
    [user, preferences]
  );

  const value: PreferencesContextValue = {
    ...preferences,
    loading,
    setPrivateWritingMode: (v) => update({ privateWritingMode: v }),
    setPrivateWritingPeekAllowed: (v) => update({ privateWritingPeekAllowed: v }),
    setAutoLockMinutes: (v) => update({ autoLockMinutes: v }),
    setDraftAutosave: (v) => update({ draftAutosave: v }),
    setDailyEntryLimit: (v) => update({ dailyEntryLimit: v }),
  };

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferences must be used within a PreferencesProvider");
  }
  return context;
}
