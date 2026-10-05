"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Carries an entry a signed-out visitor wrote on "/" through signup, so it
 * can be saved as their first entry once their keys exist.
 *
 * Memory only, never localStorage: the whole point of this app is that
 * plaintext doesn't land on disk unless someone opted into drafts
 * (lib/drafts.ts), and a visitor hasn't opted into anything yet. The cost
 * is that a full page reload mid-signup drops the text — the beforeunload
 * prompt on "/" and /signup is there so that doesn't happen silently.
 *
 * Also carries a one-shot notice ("첫 일기가 저장되었습니다") from signup to
 * /write, which is where a new account lands.
 */

interface PendingEntryValue {
  hasPendingEntry: boolean;
  setPendingEntry: (text: string) => void;
  /** Returns the pending text and forgets it. */
  takePendingEntry: () => string | null;
  notice: string | null;
  setNotice: (notice: string | null) => void;
}

const PendingEntryContext = createContext<PendingEntryValue | undefined>(undefined);

export function PendingEntryProvider({ children }: { children: ReactNode }) {
  // A ref, not state: nothing renders the text itself, only whether it exists.
  const textRef = useRef<string | null>(null);
  const [hasPendingEntry, setHasPendingEntry] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const setPendingEntry = useCallback((text: string) => {
    const trimmed = text.trim() ? text : null;
    textRef.current = trimmed;
    setHasPendingEntry(trimmed !== null);
  }, []);

  const takePendingEntry = useCallback(() => {
    const text = textRef.current;
    textRef.current = null;
    setHasPendingEntry(false);
    return text;
  }, []);

  const value = useMemo(
    () => ({ hasPendingEntry, setPendingEntry, takePendingEntry, notice, setNotice }),
    [hasPendingEntry, setPendingEntry, takePendingEntry, notice]
  );

  return <PendingEntryContext.Provider value={value}>{children}</PendingEntryContext.Provider>;
}

export function usePendingEntry(): PendingEntryValue {
  const context = useContext(PendingEntryContext);
  if (!context) {
    throw new Error("usePendingEntry must be used within a PendingEntryProvider");
  }
  return context;
}
