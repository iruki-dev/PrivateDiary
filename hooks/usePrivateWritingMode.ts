"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Two independent boolean prefs for the /write blur feature (used from
 * app/settings/page.tsx and app/write/page.tsx). Both are display-only —
 * they never touch encryption or Firestore — and both live in
 * localStorage, not the user's Firestore doc: "is someone next to me
 * right now" is a property of the DEVICE/moment, not the account, so
 * there's no reason to sync across devices or add a Firestore
 * schema/rules change for a preference that's never security-relevant.
 *
 * useSyncExternalStore (not useState+useEffect) because localStorage is
 * exactly the kind of external, possibly-multi-tab-mutated store it's
 * designed for: reading it needs a server snapshot (the default —
 * localStorage doesn't exist during SSR) distinct from the client's real
 * value, without a read-on-mount + setState-in-effect dance.
 */
function createFlagHook(key: string, defaultValue: boolean): () => [boolean, (next: boolean) => void] {
  function subscribe(callback: () => void): () => void {
    window.addEventListener("storage", callback);
    return () => window.removeEventListener("storage", callback);
  }

  function getSnapshot(): boolean {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? defaultValue : raw === "1";
    } catch {
      return defaultValue; // private browsing / blocked storage
    }
  }

  function getServerSnapshot(): boolean {
    return defaultValue;
  }

  return function useFlag(): [boolean, (next: boolean) => void] {
    const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const setEnabled = useCallback((next: boolean) => {
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        return; // nothing persisted, so nothing changed to notify subscribers about
      }
      // The native `storage` event only fires in OTHER tabs, not this one —
      // dispatching it ourselves makes this tab's useSyncExternalStore
      // subscribers re-check getSnapshot() too.
      window.dispatchEvent(new StorageEvent("storage", { key }));
    }, []);

    return [enabled, setEnabled];
  };
}

/** Blurs the /write textarea while typing. Off by default. */
export const usePrivateWritingMode = createFlagHook("privatediary:privateWritingMode", false);

/**
 * Whether /write shows the hold-to-peek icon at all. Turning this off
 * means there is NO way to see the text while private mode is on, even
 * for the writer — a deliberate stronger-privacy option (app/write's doc
 * comment). On by default so the common case (peeking at your own text)
 * keeps working without an extra opt-in.
 */
export const usePrivateWritingPeekAllowed = createFlagHook("privatediary:privateWritingPeekAllowed", true);
