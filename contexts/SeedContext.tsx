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
import { getUserKeyRecord, resetUserKeyRecord, updateWrappedSeed } from "@/lib/firebase/users";
import {
  deriveHybridKeyPair,
  generateMasterSeed,
  generateMnemonic,
  rewrapSeed,
  unwrapSeed,
  wipeBytes,
  wrapSeed,
  type HybridPrivateKeys,
  type HybridPublicKeysRaw,
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
   * discards the old one. Every previously written entry becomes
   * permanently undecryptable — the caller (UI) is responsible for warning
   * the user before calling this. Returns the new 24-word mnemonic, which
   * the caller must show via MnemonicReveal exactly once.
   */
  resetKeys: (newPassphrase: string) => Promise<string>;
}

const SeedContext = createContext<SeedContextValue | undefined>(undefined);

export function SeedProvider({ children }: { children: ReactNode }) {
  const { user, status: authStatus } = useAuth();
  const [status, setStatus] = useState<SeedStatus>("unknown");
  const [publicKeys, setPublicKeys] = useState<HybridPublicKeysRaw | null>(null);
  const [privateKeys, setPrivateKeys] = useState<HybridPrivateKeys | null>(null);
  const wrappedSeedRef = useRef<WrappedSeed | null>(null);

  const wipePrivateKeys = useCallback(() => {
    setPrivateKeys((prev) => {
      if (prev) wipeBytes(prev.x25519SecretKey, prev.mlkem768SecretKey);
      return null;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!user) {
      wrappedSeedRef.current = null;
      setPublicKeys(null);
      setStatus("unknown");
      return;
    }
    const record = await getUserKeyRecord(user.uid);
    if (!record) {
      wrappedSeedRef.current = null;
      setPublicKeys(null);
      setStatus("not-issued");
      return;
    }
    wrappedSeedRef.current = record.wrappedSeed;
    setPublicKeys(record.publicKeys);
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
      wrappedSeedRef.current = null;
      setPublicKeys(null);
      setStatus("unknown");
    }
    // "loading" leaves seed state as-is until auth resolves.
  }, [authStatus, refresh, wipePrivateKeys]);

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
      const words = generateMnemonic(seed);
      wipeBytes(seed, privateKeys.x25519SecretKey, privateKeys.mlkem768SecretKey);

      await resetUserKeyRecord(user.uid, newPublicKeys, wrapped);

      wrappedSeedRef.current = wrapped;
      setPublicKeys(newPublicKeys);
      wipePrivateKeys();
      setStatus("locked");
      return words;
    },
    [user, wipePrivateKeys]
  );

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
