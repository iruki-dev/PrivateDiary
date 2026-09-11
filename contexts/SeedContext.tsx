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
 * "unlocked".
 *
 * Recovery methods (opt-in secondary backup, see lib/crypto/recovery.ts)
 * follow a two-phase stage/commit protocol modeled after real 2FA-recovery
 * UX: to CREATE a recovery method you must stage a seed via the
 * passphrase; to CHANGE or REMOVE one you must stage a seed by proving you
 * still hold the CURRENTLY configured method. Either way, once a seed is
 * staged, the same commit* actions install the new method (or none) — the
 * commit step itself never needs to know how the seed was obtained.
 */

export type SeedStatus = "unknown" | "not-issued" | "locked" | "unlocked";

interface SeedContextValue {
  status: SeedStatus;
  publicKeys: HybridPublicKeysRaw | null;
  privateKeys: HybridPrivateKeys | null;
  /** Unwraps the seed with `passphrase` and derives private keys for this session. Throws WrongPassphraseError on failure. */
  unlock: (passphrase: string) => Promise<void>;
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
  /** True once a seed has been staged and is ready to commit. */
  hasStagedSeed: () => boolean;
  /** Discards a staged seed without committing anything (e.g. user cancels the flow). */
  discardStagedSeed: () => void;
  /** Installs recovery-key recovery using the staged seed; returns the raw key to show exactly once. Consumes the staged seed. */
  commitRecoveryKey: () => Promise<Uint8Array>;
  /** Installs Shamir recovery using the staged seed; returns the shares to show exactly once. Consumes the staged seed. */
  commitShamirRecovery: (n: number, k: number) => Promise<Uint8Array[]>;
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

  const wipePrivateKeys = useCallback(() => {
    setPrivateKeys((prev) => {
      if (prev) wipeBytes(prev.x25519SecretKey, prev.mlkem768SecretKey);
      return null;
    });
  }, []);

  const clearStagedSeed = useCallback(() => {
    if (stagedSeedRef.current) wipeBytes(stagedSeedRef.current);
    stagedSeedRef.current = null;
  }, []);

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

  const unlock = useCallback(async (passphrase: string) => {
    if (!wrappedSeedRef.current) {
      throw new Error("No wrapped seed available to unlock");
    }
    const seed = await unwrapSeed(wrappedSeedRef.current, passphrase);
    const derived = deriveHybridKeyPair(seed);
    wipeBytes(seed);
    setPrivateKeys(derived.privateKeys);
    setStatus("unlocked");
  }, []);

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

  const stageSeedFromPassphrase = useCallback(async (passphrase: string) => {
    if (!wrappedSeedRef.current) {
      throw new Error("No wrapped seed available");
    }
    const seed = await unwrapSeed(wrappedSeedRef.current, passphrase);
    clearStagedSeed();
    stagedSeedRef.current = seed;
  }, [clearStagedSeed]);

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

  const hasStagedSeed = useCallback(() => stagedSeedRef.current !== null, []);
  const discardStagedSeed = useCallback(() => clearStagedSeed(), [clearStagedSeed]);

  const commitRecoveryKey = useCallback(async () => {
    if (!user || !stagedSeedRef.current) {
      throw new Error("No staged seed to install a recovery key from");
    }
    const key = generateRecoveryKey();
    const wrapped = await wrapSeedWithRecoveryKey(stagedSeedRef.current, key);
    await setUserRecoveryKey(user.uid, wrapped);
    clearStagedSeed();
    recoveryWrappedSeedRef.current = wrapped;
    setRecoveryConfig({ type: "recovery-key" });
    return key;
  }, [user, clearStagedSeed]);

  const commitShamirRecovery = useCallback(
    async (n: number, k: number) => {
      if (!user || !stagedSeedRef.current) {
        throw new Error("No staged seed to install Shamir recovery from");
      }
      const shares = await splitSeedShamir(stagedSeedRef.current, n, k);
      await setUserShamirRecovery(user.uid, n, k);
      clearStagedSeed();
      recoveryWrappedSeedRef.current = null;
      setRecoveryConfig({ type: "shamir", n, k });
      return shares;
    },
    [user, clearStagedSeed]
  );

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
        lock,
        refresh,
        changePassphrase,
        resetKeys,
        recoveryConfig,
        stageSeedFromPassphrase,
        stageSeedFromRecoveryKey,
        stageSeedFromShamirShares,
        hasStagedSeed,
        discardStagedSeed,
        commitRecoveryKey,
        commitShamirRecovery,
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
