"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "privatediary:privateWritingMode";

/**
 * Whether to blur the /write textarea while typing (components/ below use
 * this purely for display — it never touches encryption or what's sent to
 * Firestore). Kept in localStorage rather than the user's Firestore doc:
 * this is a "is someone next to me right now" judgment call, which is a
 * property of the DEVICE/moment, not the account — no reason to sync it
 * across devices, and no reason to add a Firestore schema/rules change for
 * a preference that never touches anything security-relevant.
 *
 * useSyncExternalStore (not useState+useEffect) because localStorage is
 * exactly the kind of external, possibly-multi-tab-mutated store it's
 * designed for: reading it needs a server snapshot (false — localStorage
 * doesn't exist during SSR) distinct from the client's real value, without
 * the read-on-mount + setState-in-effect dance that would otherwise need.
 */
function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false; // private browsing / blocked storage
  }
}

function getServerSnapshot(): boolean {
  return false;
}

export function usePrivateWritingMode(): [boolean, (next: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setEnabled = useCallback((next: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      return; // nothing persisted, so nothing changed to notify subscribers about
    }
    // The native `storage` event only fires in OTHER tabs, not this one —
    // dispatching it ourselves makes this tab's useSyncExternalStore
    // subscribers re-check getSnapshot() too.
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
  }, []);

  return [enabled, setEnabled];
}
