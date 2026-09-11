"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { getUserPreferences, setUserPreferences, type UserPreferences } from "@/lib/firebase/users";

/**
 * Pure display preferences (ARCHITECTURE.md §3.9) — e.g. whether /write
 * blurs while typing. Deliberately account-level (users/{uid}.preferences)
 * rather than localStorage: the user asked for these to follow them across
 * devices. Kept as its own context rather than folded into SeedContext
 * because it has nothing to do with the master seed/keys — just like
 * OtpContext, it only needs to know who's signed in (AuthContext).
 */

const DEFAULT_PREFERENCES: UserPreferences = {
  privateWritingMode: false,
  privateWritingPeekAllowed: true,
};

interface PreferencesContextValue extends UserPreferences {
  loading: boolean;
  setPrivateWritingMode: (value: boolean) => Promise<void>;
  setPrivateWritingPeekAllowed: (value: boolean) => Promise<void>;
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
      }
    },
    [user, preferences]
  );

  const value: PreferencesContextValue = {
    ...preferences,
    loading,
    setPrivateWritingMode: (v) => update({ privateWritingMode: v }),
    setPrivateWritingPeekAllowed: (v) => update({ privateWritingPeekAllowed: v }),
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
