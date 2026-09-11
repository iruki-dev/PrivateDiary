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
  setShamirMethod as setShamirMethodFirestore,
  disableShamirMethod as disableShamirMethodFirestore,
  updateWrappedSeed,
} from "@/lib/firebase/users";
import {
  combineSeedShamir,
  deriveHybridKeyPair,
  generateMasterSeed,
  rewrapSeed,
  seedMatchesPublicKeys,
  splitSeedShamir,
  unwrapSeed,
  wipeBytes,
  wrapSeed,
  InvalidShamirSharesError,
  type DecryptionMethodsConfig,
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
 * "unlocked", reachable via the passphrase or, if configured, K of the
 * enabled Shamir shares.
 *
 * Passphrase and Shamir shares are CO-EQUAL master credentials
 * (ARCHITECTURE.md §3.7) — either one, on its own, can:
 *   1. Decrypt the diary (unlock / unlockWithShamirShares).
 *   2. Reset the passphrase to a new value (changePassphrase /
 *      resetPassphraseWithShamirShares) without touching the seed, so every
 *      existing entry and any already-issued Shamir shares stay valid.
 *   3. Create or reissue Shamir shares from the current seed (stage +
 *      prepareShamir + confirmPendingShamir).
 * Neither can reveal the other's actual value: reconstructing the seed from
 * Shamir shares never yields the passphrase string (the passphrase is never
 * derived from or embedded in the seed), and unwrapping the seed via the
 * passphrase never yields a previously-issued set of Shamir shares (split()
 * draws fresh randomness on every call — see recovery.test.ts). This is why
 * the passphrase is the everyday default, with Shamir as the one thing that
 * still works if the passphrase itself is lost.
 *
 * Setting up or reissuing Shamir follows a three-phase stage/prepare/confirm
 * protocol so nothing is written to Firestore until the user has
 * acknowledged saving the newly generated shares:
 *
 * 1. STAGE proves you currently hold ONE of the two co-equal credentials —
 *    via the passphrase, or via K existing Shamir shares. This only
 *    reconstructs the seed in memory; nothing is written to Firestore yet.
 * 2. PREPARE splits the staged seed into a fresh set of Shamir shares and
 *    returns them for display — still nothing written to Firestore.
 * 3. CONFIRM is the ONLY step that writes to Firestore, overwriting whatever
 *    Shamir configuration existed before, and only fires once the user has
 *    acknowledged (via SecretReveal) that they've saved the shares. If the
 *    user navigates away before confirming, nothing was ever written.
 *    discardStagedSeed() (also called automatically on unmount) wipes any
 *    staged seed and unconfirmed prepared shares.
 *
 * Disabling Shamir only requires a staged seed (via either credential,
 * since they're co-equal) — there is no "prove this specific method" gate
 * the way there was under the earlier OR-toggle recovery-method design.
 */

export type SeedStatus = "unknown" | "not-issued" | "locked" | "unlocked";

interface PendingShamir {
  shares: Uint8Array[];
  n: number;
  k: number;
}

interface SeedContextValue {
  status: SeedStatus;
  publicKeys: HybridPublicKeysRaw | null;
  privateKeys: HybridPrivateKeys | null;
  /** Unwraps the seed with `passphrase` and derives private keys for this session. Throws WrongPassphraseError on failure. */
  unlock: (passphrase: string) => Promise<void>;
  /** Unlocks using K of the enabled Shamir shares instead of the passphrase. Throws InvalidShamirSharesError on failure. */
  unlockWithShamirShares: (shares: Uint8Array[]) => Promise<void>;
  /** Wipes private keys from memory; returns to "locked". */
  lock: () => void;
  /** Re-reads users/{uid} from Firestore (e.g. right after key issuance). */
  refresh: () => Promise<void>;
  /**
   * Passphrase change: requires the correct current passphrase. Throws
   * WrongPassphraseError otherwise, and changes nothing.
   */
  changePassphrase: (oldPassphrase: string, newPassphrase: string) => Promise<void>;
  /**
   * Resets a forgotten passphrase using K of the enabled Shamir shares
   * instead of the old passphrase. The underlying seed is unchanged — every
   * existing entry and any already-issued Shamir shares stay valid. Also
   * unlocks the session, since the caller just proved a master credential.
   * Throws InvalidShamirSharesError if the shares don't reconstruct the
   * seed on file.
   */
  resetPassphraseWithShamirShares: (shares: Uint8Array[], newPassphrase: string) => Promise<void>;
  /**
   * "초기화" (ARCHITECTURE.md §3.6 rule 5): issues a brand-new seed and
   * discards the old one, including any configured Shamir shares. Every
   * previously written entry becomes permanently undecryptable — the
   * caller (UI) is responsible for warning the user before calling this.
   * This is the true last resort; a merely-forgotten passphrase should use
   * resetPassphraseWithShamirShares instead, which keeps every entry.
   */
  resetKeys: (newPassphrase: string) => Promise<void>;

  /** Currently enabled decryption methods, or null while still loading. */
  decryptionMethods: DecryptionMethodsConfig | null;
  /** Stage a seed via the passphrase. Throws WrongPassphraseError on failure. */
  stageSeedFromPassphrase: (passphrase: string) => Promise<void>;
  /** Stage a seed by proving K of the enabled Shamir shares. Throws InvalidShamirSharesError on failure. */
  stageSeedFromShamirShares: (shares: Uint8Array[]) => Promise<void>;
  /** Discards a staged seed and any unconfirmed prepared shares without writing anything (cancel, or automatic on unmount). */
  discardStagedSeed: () => void;
  /** Splits the staged seed into a fresh set of Shamir shares and returns them for display. Does NOT write to Firestore yet — works for both first-time setup and reissue. */
  prepareShamir: (n: number, k: number) => Promise<Uint8Array[]>;
  /** Writes the prepared Shamir configuration to Firestore, overwriting any previous one. Call only after the user has acknowledged saving the shares. */
  confirmPendingShamir: () => Promise<void>;
  /** Disables Shamir. Requires a staged seed (via either co-equal credential). */
  disableShamir: () => Promise<void>;
}

const SeedContext = createContext<SeedContextValue | undefined>(undefined);

export function SeedProvider({ children }: { children: ReactNode }) {
  const { user, status: authStatus } = useAuth();
  const [status, setStatus] = useState<SeedStatus>("unknown");
  const [publicKeys, setPublicKeys] = useState<HybridPublicKeysRaw | null>(null);
  const [privateKeys, setPrivateKeys] = useState<HybridPrivateKeys | null>(null);
  const [decryptionMethods, setDecryptionMethods] = useState<DecryptionMethodsConfig | null>(
    null
  );
  const wrappedSeedRef = useRef<WrappedSeed | null>(null);
  const publicKeysRef = useRef<HybridPublicKeysRaw | null>(null);
  const stagedSeedRef = useRef<Uint8Array | null>(null);
  const pendingShamirRef = useRef<PendingShamir | null>(null);

  const wipePrivateKeys = useCallback(() => {
    setPrivateKeys((prev) => {
      if (prev) wipeBytes(prev.x25519SecretKey, prev.mlkem768SecretKey);
      return null;
    });
  }, []);

  const clearPendingShamir = useCallback(() => {
    const pending = pendingShamirRef.current;
    if (pending) wipeBytes(...pending.shares);
    pendingShamirRef.current = null;
  }, []);

  const clearStagedSeed = useCallback(() => {
    if (stagedSeedRef.current) wipeBytes(stagedSeedRef.current);
    stagedSeedRef.current = null;
    clearPendingShamir();
  }, [clearPendingShamir]);

  const refresh = useCallback(async () => {
    if (!user) {
      wrappedSeedRef.current = null;
      publicKeysRef.current = null;
      setPublicKeys(null);
      setDecryptionMethods(null);
      setStatus("unknown");
      return;
    }
    const record = await getUserKeyRecord(user.uid);
    if (!record) {
      wrappedSeedRef.current = null;
      publicKeysRef.current = null;
      setPublicKeys(null);
      setDecryptionMethods(null);
      setStatus("not-issued");
      return;
    }
    wrappedSeedRef.current = record.wrappedSeed;
    publicKeysRef.current = record.publicKeys;
    setPublicKeys(record.publicKeys);
    setDecryptionMethods(record.decryptionMethods);
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
      publicKeysRef.current = null;
      setPublicKeys(null);
      setDecryptionMethods(null);
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

  const resetPassphraseWithShamirShares = useCallback(
    async (shares: Uint8Array[], newPassphrase: string) => {
      if (!user) {
        throw new Error("Not signed in");
      }
      const seed = await combineSeedShamir(shares);
      if (!publicKeysRef.current || !seedMatchesPublicKeys(seed, publicKeysRef.current)) {
        wipeBytes(seed);
        throw new InvalidShamirSharesError();
      }
      const wrapped = await wrapSeed(seed, newPassphrase);
      await updateWrappedSeed(user.uid, wrapped);
      wrappedSeedRef.current = wrapped;
      deriveAndUnlock(seed);
      wipeBytes(seed);
    },
    [user, deriveAndUnlock]
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
      publicKeysRef.current = newPublicKeys;
      setPublicKeys(newPublicKeys);
      setDecryptionMethods({ shamir: null });
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

  const prepareShamir = useCallback(
    async (n: number, k: number) => {
      if (!stagedSeedRef.current) {
        throw new Error("No staged seed to prepare Shamir shares from");
      }
      const shares = await splitSeedShamir(stagedSeedRef.current, n, k);
      clearPendingShamir();
      pendingShamirRef.current = { shares, n, k };
      return shares;
    },
    [clearPendingShamir]
  );

  const confirmPendingShamir = useCallback(async () => {
    if (!user || !pendingShamirRef.current) {
      throw new Error("No prepared Shamir shares to confirm");
    }
    const { n, k } = pendingShamirRef.current;
    await setShamirMethodFirestore(user.uid, n, k);
    setDecryptionMethods({ shamir: { n, k } });
    clearStagedSeed();
  }, [user, clearStagedSeed]);

  const disableShamir = useCallback(async () => {
    if (!user || !stagedSeedRef.current) {
      throw new Error("No staged seed to prove removal with");
    }
    await disableShamirMethodFirestore(user.uid);
    clearStagedSeed();
    setDecryptionMethods({ shamir: null });
  }, [user, clearStagedSeed]);

  return (
    <SeedContext.Provider
      value={{
        status,
        publicKeys,
        privateKeys,
        unlock,
        unlockWithShamirShares,
        lock,
        refresh,
        changePassphrase,
        resetPassphraseWithShamirShares,
        resetKeys,
        decryptionMethods,
        stageSeedFromPassphrase,
        stageSeedFromShamirShares,
        discardStagedSeed,
        prepareShamir,
        confirmPendingShamir,
        disableShamir,
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
