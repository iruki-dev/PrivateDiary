"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthContext";
import {
  getUserKeyRecord,
  resetUserKeyRecord,
  setUserRecoveryKey,
  setUserShamirRecovery,
  clearUserRecovery,
  updateWrappedSeed,
} from "@/lib/firebase/users";
import {
  combineSeedShamir,
  deriveHybridKeyPair,
  generateMasterSeed,
  generateRecoveryKey,
  rewrapSeed,
  seedMatchesPublicKeys,
  splitSeedShamir,
  unwrapSeed,
  unwrapSeedWithRecoveryKey,
  wipeBytes,
  wrapSeed,
  wrapSeedWithRecoveryKey,
  InvalidRecoveryKeyError,
  InvalidShamirSharesError,
  type HybridPrivateKeys,
  type HybridPublicKeysRaw,
  type RecoveryConfig,
  type RecoveryKeyWrappedSeed,
  type WrappedSeed,
} from "@/lib/crypto";

/**
 * Tracks master-seed/key state, entirely separate from login state
 * (ARCHITECTURE.md rule 5, Phase 2). Four states:
 *
 * - "unknown"     — still checking (or not signed in yet)
 * - "not-issued"  — signed in, but users/{uid} has no publicKeys/wrappedSeed yet
 * - "locked"      — keys exist in Firestore, but not unwrapped in this session
 * - "unlocked"    — master seed was unwrapped this session; privateKeys live in memory
 *
 * Writing an entry only needs `publicKeys` + being signed in — it works in
 * "locked" state too (ARCHITECTURE.md §3.2 rule 5). Only reading needs
 * "unlocked", which can be reached three ways: passphrase (unlock), or —
 * if configured — a recovery key or Shamir shares
 * (unlockWithRecoveryKey / unlockWithShamirShares). This is the actual
 * point of having a recovery method: not just being ABLE to configure one,
 * but being able to read your diary with it when the passphrase is lost.
 *
 * Recovery *configuration* (create/change/remove, as opposed to using one
 * to unlock) follows a three-phase stage/prepare/confirm protocol:
 *
 * 1. STAGE proves identity — via the passphrase if recoveryConfig is
 *    "none" (nothing else to prove yet), or by re-proving the CURRENTLY
 *    configured method otherwise (2FA-change-needs-2FA reasoning: a
 *    passphrase-only compromise shouldn't be able to silently swap the
 *    recovery method). This only reconstructs the seed in memory; nothing
 *    is written to Firestore yet.
 * 2. PREPARE generates the new method's material (a recovery key, or
 *    Shamir shares) from the staged seed and returns it for display —
 *    still nothing written to Firestore. This is deliberately separate
 *    from staging so the UI can show the material before committing to it.
 * 3. CONFIRM is the ONLY step that writes to Firestore, and only fires
 *    when the user has acknowledged (via SecretReveal) that they've saved
 *    the material. If the user navigates away before confirming, nothing
 *    was ever written — there is no "configured in Firestore but nobody
 *    actually holds the key" stuck state. discardStagedSeed() (also called
 *    automatically on unmount) wipes any staged seed and unconfirmed
 *    prepared material.
 */

export type SeedStatus = "unknown" | "not-issued" | "locked" | "unlocked";

type PendingRecovery =
  | { kind: "recovery-key"; key: Uint8Array; wrapped: RecoveryKeyWrappedSeed }
  | { kind: "shamir"; shares: Uint8Array[]; n: number; k: number };

interface SeedContextValue {
  status: SeedStatus;
  publicKeys: HybridPublicKeysRaw | null;
  privateKeys: HybridPrivateKeys | null;
  /** Unwraps the seed with `passphrase` and derives private keys for this session. Throws WrongPassphraseError on failure. */
  unlock: (passphrase: string) => Promise<void>;
  /** Unlocks using the configured recovery key instead of the passphrase. Throws InvalidRecoveryKeyError on failure. */
  unlockWithRecoveryKey: (recoveryKey: Uint8Array) => Promise<void>;
  /** Unlocks using K of the configured Shamir shares instead of the passphrase. Throws InvalidShamirSharesError on failure. */
  unlockWithShamirShares: (shares: Uint8Array[]) => Promise<void>;
  /** Wipes private keys from memory; returns to "locked". */
  lock: () => void;
  /** Re-reads users/{uid} from Firestore (e.g. right after key issuance). */
  refresh: () => Promise<void>;
  /**
   * Passphrase change (ARCHITECTURE.md §3.6 rule 5): requires the correct
   * current passphrase. Throws WrongPassphraseError otherwise, and changes
   * nothing.
   */
  changePassphrase: (oldPassphrase: string, newPassphrase: string) => Promise<void>;
  /**
   * "초기화" (ARCHITECTURE.md §3.6 rule 5): issues a brand-new seed and
   * discards the old one, including any configured recovery method. Every
   * previously written entry becomes permanently undecryptable — the
   * caller (UI) is responsible for warning the user before calling this.
   */
  resetKeys: (newPassphrase: string) => Promise<void>;

  /** Currently configured recovery method, or null while still loading. */
  recoveryConfig: RecoveryConfig | null;
  /** Stage a seed via the account passphrase — the only proof available when recoveryConfig is "none". Throws WrongPassphraseError on failure. */
  stageSeedFromPassphrase: (passphrase: string) => Promise<void>;
  /** Stage a seed by proving the currently-configured recovery key. Throws InvalidRecoveryKeyError on failure. */
  stageSeedFromRecoveryKey: (recoveryKey: Uint8Array) => Promise<void>;
  /** Stage a seed by proving K of the currently-configured Shamir shares. Throws InvalidShamirSharesError on failure. */
  stageSeedFromShamirShares: (shares: Uint8Array[]) => Promise<void>;
  /** Discards a staged seed and any unconfirmed prepared recovery material without writing anything (cancel, or automatic on unmount). */
  discardStagedSeed: () => void;
  /** Generates a new recovery key from the staged seed and returns it for display. Does NOT write to Firestore yet. */
  prepareRecoveryKey: () => Promise<Uint8Array>;
  /** Splits the staged seed into Shamir shares and returns them for display. Does NOT write to Firestore yet. */
  prepareShamirRecovery: (n: number, k: number) => Promise<Uint8Array[]>;
  /** Writes whatever was prepared (recovery key or Shamir config) to Firestore. Call only after the user has acknowledged saving the material. */
  confirmPendingRecovery: () => Promise<void>;
  /** Removes whatever recovery method is configured, using the staged seed as proof. Consumes the staged seed. */
  commitRemoveRecovery: () => Promise<void>;
}

const SeedContext = createContext<SeedContextValue | undefined>(undefined);

export function SeedProvider({ children }: { children: ReactNode }) {
  const { user, status: authStatus } = useAuth();
  const [status, setStatus] = useState<SeedStatus>("unknown");
  const [publicKeys, setPublicKeys] = useState<HybridPublicKeysRaw | null>(null);
  const [privateKeys, setPrivateKeys] = useState<HybridPrivateKeys | null>(null);
  const [recoveryConfig, setRecoveryConfig] = useState<RecoveryConfig | null>(null);
  const wrappedSeedRef = useRef<WrappedSeed | null>(null);
  const recoveryWrappedSeedRef = useRef<RecoveryKeyWrappedSeed | null>(null);
  const publicKeysRef = useRef<HybridPublicKeysRaw | null>(null);
  const stagedSeedRef = useRef<Uint8Array | null>(null);
  const pendingRecoveryRef = useRef<PendingRecovery | null>(null);

  const wipePrivateKeys = useCallback(() => {
    setPrivateKeys((prev) => {
      if (prev) wipeBytes(prev.x25519SecretKey, prev.mlkem768SecretKey);
      return null;
    });
  }, []);

  const clearPendingRecovery = useCallback(() => {
    const pending = pendingRecoveryRef.current;
    if (pending?.kind === "recovery-key") {
      wipeBytes(pending.key);
    } else if (pending?.kind === "shamir") {
      wipeBytes(...pending.shares);
    }
    pendingRecoveryRef.current = null;
  }, []);

  const clearStagedSeed = useCallback(() => {
    if (stagedSeedRef.current) wipeBytes(stagedSeedRef.current);
    stagedSeedRef.current = null;
    clearPendingRecovery();
  }, [clearPendingRecovery]);

  const refresh = useCallback(async () => {
    if (!user) {
      wrappedSeedRef.current = null;
      recoveryWrappedSeedRef.current = null;
      publicKeysRef.current = null;
      setPublicKeys(null);
      setRecoveryConfig(null);
      setStatus("unknown");
      return;
    }
    const record = await getUserKeyRecord(user.uid);
    if (!record) {
      wrappedSeedRef.current = null;
      recoveryWrappedSeedRef.current = null;
      publicKeysRef.current = null;
      setPublicKeys(null);
      setRecoveryConfig(null);
      setStatus("not-issued");
      return;
    }
    wrappedSeedRef.current = record.wrappedSeed;
    recoveryWrappedSeedRef.current = record.recoveryWrappedSeed;
    publicKeysRef.current = record.publicKeys;
    setPublicKeys(record.publicKeys);
    setRecoveryConfig(record.recoveryConfig);
    setStatus((prev) => (prev === "unlocked" ? "unlocked" : "locked"));
  }, [user]);

  useEffect(() => {
    if (authStatus === "signed-in") {
      // refresh() reads Firestore (browser-only, async) to learn whether
      // this uid has issued keys yet; it's also called imperatively later
      // (e.g. right after onboarding writes the key-issuance doc), so it
      // can't be reduced to state derived purely from props during render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void refresh();
    } else if (authStatus === "signed-out") {
      wipePrivateKeys();
      clearStagedSeed();
      wrappedSeedRef.current = null;
      recoveryWrappedSeedRef.current = null;
      publicKeysRef.current = null;
      setPublicKeys(null);
      setRecoveryConfig(null);
      setStatus("unknown");
    }
    // "loading" leaves seed state as-is until auth resolves.
  }, [authStatus, refresh, wipePrivateKeys, clearStagedSeed]);

  const deriveAndUnlock = useCallback((seed: Uint8Array) => {
    const derived = deriveHybridKeyPair(seed);
    setPrivateKeys(derived.privateKeys);
    setStatus("unlocked");
  }, []);

  const unlock = useCallback(
    async (passphrase: string) => {
      if (!wrappedSeedRef.current) {
        throw new Error("No wrapped seed available to unlock");
      }
      const seed = await unwrapSeed(wrappedSeedRef.current, passphrase);
      deriveAndUnlock(seed);
      wipeBytes(seed);
    },
    [deriveAndUnlock]
  );

  const unlockWithRecoveryKey = useCallback(
    async (recoveryKey: Uint8Array) => {
      if (!recoveryWrappedSeedRef.current) {
        throw new Error("No recovery key is configured");
      }
      const seed = await unwrapSeedWithRecoveryKey(recoveryWrappedSeedRef.current, recoveryKey);
      if (!publicKeysRef.current || !seedMatchesPublicKeys(seed, publicKeysRef.current)) {
        wipeBytes(seed);
        throw new InvalidRecoveryKeyError();
      }
      deriveAndUnlock(seed);
      wipeBytes(seed);
    },
    [deriveAndUnlock]
  );

  const unlockWithShamirShares = useCallback(
    async (shares: Uint8Array[]) => {
      const seed = await combineSeedShamir(shares);
      if (!publicKeysRef.current || !seedMatchesPublicKeys(seed, publicKeysRef.current)) {
        wipeBytes(seed);
        throw new InvalidShamirSharesError();
      }
      deriveAndUnlock(seed);
      wipeBytes(seed);
    },
    [deriveAndUnlock]
  );

  const lock = useCallback(() => {
    wipePrivateKeys();
    setStatus((prev) => (prev === "unlocked" ? "locked" : prev));
  }, [wipePrivateKeys]);

  const changePassphrase = useCallback(
    async (oldPassphrase: string, newPassphrase: string) => {
      if (!user || !wrappedSeedRef.current) {
        throw new Error("No wrapped seed available");
      }
      const rewrapped = await rewrapSeed(wrappedSeedRef.current, oldPassphrase, newPassphrase);
      await updateWrappedSeed(user.uid, rewrapped);
      wrappedSeedRef.current = rewrapped;
    },
    [user]
  );

  const resetKeys = useCallback(
    async (newPassphrase: string) => {
      if (!user) {
        throw new Error("Not signed in");
      }
      const seed = generateMasterSeed();
      const { publicKeys: newPublicKeys, privateKeys } = deriveHybridKeyPair(seed);
      const wrapped = await wrapSeed(seed, newPassphrase);
      wipeBytes(seed, privateKeys.x25519SecretKey, privateKeys.mlkem768SecretKey);

      await resetUserKeyRecord(user.uid, newPublicKeys, wrapped);

      wrappedSeedRef.current = wrapped;
      recoveryWrappedSeedRef.current = null;
      publicKeysRef.current = newPublicKeys;
      setPublicKeys(newPublicKeys);
      setRecoveryConfig({ type: "none" });
      wipePrivateKeys();
      setStatus("locked");
    },
    [user, wipePrivateKeys]
  );

  const stageSeedFromPassphrase = useCallback(
    async (passphrase: string) => {
      if (!wrappedSeedRef.current) {
        throw new Error("No wrapped seed available");
      }
      const seed = await unwrapSeed(wrappedSeedRef.current, passphrase);
      clearStagedSeed();
      stagedSeedRef.current = seed;
    },
    [clearStagedSeed]
  );

  const stageSeedFromRecoveryKey = useCallback(
    async (recoveryKey: Uint8Array) => {
      if (!recoveryWrappedSeedRef.current) {
        throw new Error("No recovery key is configured");
      }
      const seed = await unwrapSeedWithRecoveryKey(recoveryWrappedSeedRef.current, recoveryKey);
      if (!publicKeysRef.current || !seedMatchesPublicKeys(seed, publicKeysRef.current)) {
        wipeBytes(seed);
        throw new InvalidRecoveryKeyError();
      }
      clearStagedSeed();
      stagedSeedRef.current = seed;
    },
    [clearStagedSeed]
  );

  const stageSeedFromShamirShares = useCallback(
    async (shares: Uint8Array[]) => {
      const seed = await combineSeedShamir(shares);
      if (!publicKeysRef.current || !seedMatchesPublicKeys(seed, publicKeysRef.current)) {
        wipeBytes(seed);
        throw new InvalidShamirSharesError();
      }
      clearStagedSeed();
      stagedSeedRef.current = seed;
    },
    [clearStagedSeed]
  );

  const discardStagedSeed = useCallback(() => clearStagedSeed(), [clearStagedSeed]);

  const prepareRecoveryKey = useCallback(async () => {
    if (!stagedSeedRef.current) {
      throw new Error("No staged seed to prepare a recovery key from");
    }
    const key = generateRecoveryKey();
    const wrapped = await wrapSeedWithRecoveryKey(stagedSeedRef.current, key);
    clearPendingRecovery();
    pendingRecoveryRef.current = { kind: "recovery-key", key, wrapped };
    return key;
  }, [clearPendingRecovery]);

  const prepareShamirRecovery = useCallback(
    async (n: number, k: number) => {
      if (!stagedSeedRef.current) {
        throw new Error("No staged seed to prepare Shamir recovery from");
      }
      const shares = await splitSeedShamir(stagedSeedRef.current, n, k);
      clearPendingRecovery();
      pendingRecoveryRef.current = { kind: "shamir", shares, n, k };
      return shares;
    },
    [clearPendingRecovery]
  );

  const confirmPendingRecovery = useCallback(async () => {
    if (!user || !pendingRecoveryRef.current) {
      throw new Error("No prepared recovery material to confirm");
    }
    const pending = pendingRecoveryRef.current;
    if (pending.kind === "recovery-key") {
      await setUserRecoveryKey(user.uid, pending.wrapped);
      recoveryWrappedSeedRef.current = pending.wrapped;
      setRecoveryConfig({ type: "recovery-key" });
    } else {
      await setUserShamirRecovery(user.uid, pending.n, pending.k);
      recoveryWrappedSeedRef.current = null;
      setRecoveryConfig({ type: "shamir", n: pending.n, k: pending.k });
    }
    clearStagedSeed();
  }, [user, clearStagedSeed]);

  const commitRemoveRecovery = useCallback(async () => {
    if (!user || !stagedSeedRef.current) {
      throw new Error("No staged seed to prove removal with");
    }
    await clearUserRecovery(user.uid);
    clearStagedSeed();
    recoveryWrappedSeedRef.current = null;
    setRecoveryConfig({ type: "none" });
  }, [user, clearStagedSeed]);

  return (
    <SeedContext.Provider
      value={{
        status,
        publicKeys,
        privateKeys,
        unlock,
        unlockWithRecoveryKey,
        unlockWithShamirShares,
        lock,
        refresh,
        changePassphrase,
        resetKeys,
        recoveryConfig,
        stageSeedFromPassphrase,
        stageSeedFromRecoveryKey,
        stageSeedFromShamirShares,
        discardStagedSeed,
        prepareRecoveryKey,
        prepareShamirRecovery,
        confirmPendingRecovery,
        commitRemoveRecovery,
      }}
    >
      {children}
    </SeedContext.Provider>
  );
}

export function useSeed(): SeedContextValue {
  const context = useContext(SeedContext);
  if (!context) {
    throw new Error("useSeed must be used within a SeedProvider");
  }
  return context;
}
