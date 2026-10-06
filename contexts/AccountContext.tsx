"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "./AuthContext";
import { signOut } from "@/lib/firebase/auth";
import { readDeviceMode, localDiaryId, writeDeviceMode, type AppMode } from "@/lib/deviceMode";
import { IS_ANDROID_APP } from "@/lib/platform";
import { isNativeApp } from "@/lib/native/bridge";
import { setNetworkBlocked } from "@/lib/native/app";
import { CloudStore } from "@/lib/store/cloud";
import { LocalStore } from "@/lib/store/local";
import { BackupStore } from "@/lib/store/backup";
import type { DiaryStore } from "@/lib/store/types";

/**
 * Whose diary this screen works with, and where it lives (lib/store/types.ts):
 *
 *   - cloud  — the signed-in Firebase account (AuthContext).
 *   - local  — the Android app's fully local diary (lib/deviceMode.ts).
 *   - backup — the phone's read-only copy of a cloud account's diary
 *              (lib/store/backup.ts), opened when the server can't be
 *              reached — even while signed out, since signing in needs it.
 *
 * Everything below this provider (preferences, the biometric check, seed
 * state, the pages) reads the account and its store from here instead of
 * from Firebase directly, so one diary's state never leaks into another's:
 * each account kind has its own id, and changing account resets the
 * contexts keyed on it.
 */

export type DiaryAccount =
  | { kind: "cloud"; id: string; user: User }
  | { kind: "local"; id: string }
  | { kind: "backup"; id: string; label: string };

export type AccountStatus = "loading" | "signed-out" | "signed-in";

interface AccountContextValue {
  status: AccountStatus;
  account: DiaryAccount | null;
  store: DiaryStore | null;
  /** This device's mode. Always "cloud" on the website. */
  mode: AppMode;
  /** Opens the phone's copy of an account's diary, read-only. Android app only. */
  openBackup: (uid: string, label: string) => void;
  closeBackup: () => void;
  /** Switches this phone to the fully local diary: signs out of any account and cuts the network. */
  startLocalMode: () => Promise<void>;
  /** Back to accounts; the local diary stays on the phone. */
  leaveLocalMode: () => void;
}

const AccountContext = createContext<AccountContextValue | undefined>(undefined);

export function AccountProvider({ children }: { children: ReactNode }) {
  const { user, status: authStatus } = useAuth();
  // Read after mount: the static pages are prerendered without storage,
  // so the first render must not depend on it.
  const [mode, setMode] = useState<AppMode | null>(IS_ANDROID_APP ? null : "cloud");
  const [backupView, setBackupView] = useState<{ uid: string; label: string } | null>(null);
  const [localId, setLocalId] = useState<string | null>(null);

  useEffect(() => {
    if (!IS_ANDROID_APP) return;
    const stored = readDeviceMode();
    // Device storage is only readable after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(stored);
    if (stored === "local") setLocalId(localDiaryId());
  }, []);

  // The app's network block follows the mode — on every start too, so the
  // two can't drift apart (MainActivity also keeps it across restarts).
  useEffect(() => {
    if (mode === null || !isNativeApp()) return;
    void setNetworkBlocked(mode === "local").catch((err) => console.error("network block", err));
  }, [mode]);

  const openBackup = useCallback((uid: string, label: string) => setBackupView({ uid, label }), []);
  const closeBackup = useCallback(() => setBackupView(null), []);

  const startLocalMode = useCallback(async () => {
    if (!IS_ANDROID_APP) return;
    setBackupView(null);
    // The mode switches first, so the screen goes straight to the local
    // diary instead of passing through "signed out" (and a redirect to
    // the login page) on the way.
    writeDeviceMode("local");
    setLocalId(localDiaryId());
    setMode("local");
    // A cloud session left signed in would sit beside the local diary;
    // signing out keeps the two strictly apart. It clears the session on
    // the phone only, so it needs no network.
    if (authStatus === "signed-in") await signOut();
  }, [authStatus]);

  const leaveLocalMode = useCallback(() => {
    writeDeviceMode("cloud");
    setLocalId(null);
    setMode("cloud");
  }, []);

  const { status, account } = useMemo((): { status: AccountStatus; account: DiaryAccount | null } => {
    if (backupView) {
      return { status: "signed-in", account: { kind: "backup", id: backupView.uid, label: backupView.label } };
    }
    if (mode === null) return { status: "loading", account: null };
    if (mode === "local") {
      return localId
        ? { status: "signed-in", account: { kind: "local", id: localId } }
        : { status: "loading", account: null };
    }
    if (authStatus === "signed-in" && user) {
      return { status: "signed-in", account: { kind: "cloud", id: user.uid, user } };
    }
    return { status: authStatus === "loading" ? "loading" : "signed-out", account: null };
  }, [backupView, mode, localId, authStatus, user]);

  const accountKind = account?.kind ?? null;
  const accountId = account?.id ?? null;
  const store = useMemo((): DiaryStore | null => {
    if (!accountKind || !accountId) return null;
    switch (accountKind) {
      case "cloud":
        return new CloudStore(accountId);
      case "local":
        return new LocalStore(accountId);
      case "backup":
        return new BackupStore(accountId);
    }
  }, [accountKind, accountId]);

  return (
    <AccountContext.Provider
      value={{
        status,
        account,
        store,
        mode: mode ?? "cloud",
        openBackup,
        closeBackup,
        startLocalMode,
        leaveLocalMode,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const context = useContext(AccountContext);
  if (!context) throw new Error("useAccount must be used within an AccountProvider");
  return context;
}
