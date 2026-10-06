"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAccount } from "./AccountContext";
import { IS_ANDROID_APP } from "@/lib/platform";
import { isNativeApp, NativeError, onNativeEvent } from "@/lib/native/bridge";
import {
  BiometricGateError,
  biometricGateStatus,
  resetBiometricGate,
  verifyBiometricGate,
  type BiometricGateStatus,
} from "@/lib/native/app";

/**
 * The Android app's biometric check (android/.../BiometricGate.kt), handled
 * exactly like OTP (contexts/OtpContext.tsx, components/OtpGate.tsx):
 *
 *  - It is a gate IN FRONT OF the diary passphrase. Nothing that takes the
 *    passphrase is reachable until the check has passed, so the passphrase
 *    can't even be tried (let alone guessed repeatedly) without it.
 *  - The two ways in are: biometric check + passphrase, or the backup
 *    codes alone — the same choice OTP gives (OTP + passphrase, or backup
 *    codes, which bypass OTP).
 *  - It never replaces the passphrase, and nothing that can open the
 *    diary is kept on the phone.
 *
 * The pass lasts until the diary locks or the app leaves the foreground —
 * stricter than OTP's 12 hours, since the check is a touch away.
 * SeedContext enforces the gate too (its passphrase paths refuse to run
 * while `required`), so a UI path that forgot to render <BiometricGate>
 * still can't reach the passphrase.
 *
 * The check belongs to whichever diary is open (contexts/AccountContext):
 * the account's uid — for the account and for the phone's copy of it — or
 * the local diary's own id, so the two never share a pass.
 *
 * A new fingerprint or face invalidates the check (BiometricGate.kt). For
 * an account the way back is re-proving the login. A local diary has no
 * login, and the phone's copy is opened precisely when the server can't
 * be reached — so for those the check steps aside ("degraded") and the
 * diary passphrase alone opens it, saying so on screen; a local diary
 * then switches the stale check off once the passphrase has proven itself.
 */
interface BiometricGateContextValue {
  /** Still asking the app whether the check is on. Treated as "not passed". */
  loading: boolean;
  /** Null on the website. */
  status: BiometricGateStatus | null;
  /** The check is on for this account and hasn't been passed since the last lock. */
  required: boolean;
  /** Shows the biometric prompt. Throws BiometricGateError on anything but a pass. */
  verify: () => Promise<void>;
  /**
   * Counts the check as passed: after the backup codes were proven (they
   * stand in for the check, as they do for OTP), or right after turning
   * the check on (which itself passes one).
   */
  markPassed: () => void;
  /** Ends the pass (the diary locked). */
  clearPass: () => void;
  refresh: () => Promise<void>;
  /**
   * The check was invalidated on a diary that has no login to re-prove
   * (local, or the phone's copy): the passphrase is allowed without it.
   */
  degraded: boolean;
  /** After a degraded local diary was opened with its passphrase: switches the stale check off. */
  settleDegraded: () => Promise<void>;
}

const BiometricGateContext = createContext<BiometricGateContextValue | undefined>(undefined);

export function BiometricGateProvider({ children }: { children: ReactNode }) {
  const { account } = useAccount();
  const gateId = account?.id ?? null;
  const accountKind = account?.kind ?? null;
  const [status, setStatus] = useState<BiometricGateStatus | null>(null);
  const [loading, setLoading] = useState(IS_ANDROID_APP);
  const [passed, setPassed] = useState(false);

  const refresh = useCallback(async () => {
    if (!IS_ANDROID_APP) return;
    if (!gateId || !isNativeApp()) {
      // Signed out: nothing to guard. No bridge: unknown, so the gate stays closed.
      setStatus(null);
      setLoading(false);
      return;
    }
    try {
      setStatus(await biometricGateStatus(gateId));
    } catch {
      // Unknown is not "off": keep the gate closed (see `required`).
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [gateId]);

  useEffect(() => {
    // Asks the app (an async bridge call) — can't be derived during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPassed(false);
    void refresh();
  }, [refresh]);

  // Leaving the app ends the pass, whether or not the diary was open.
  useEffect(() => {
    if (!isNativeApp()) return;
    return onNativeEvent("lifecycle", (data) => {
      if (data.state === "background" || (typeof data.awayMs === "number" && data.awayMs > 0)) setPassed(false);
    });
  }, []);

  const verify = useCallback(async () => {
    if (!gateId) throw new BiometricGateError("failed");
    try {
      await verifyBiometricGate(gateId);
    } catch (err) {
      throw new BiometricGateError(err instanceof NativeError ? err.code : "failed");
    }
    setPassed(true);
  }, [gateId]);

  const markPassed = useCallback(() => setPassed(true), []);
  const clearPass = useCallback(() => setPassed(false), []);

  const degraded = status?.invalidated === true && (accountKind === "local" || accountKind === "backup");

  const settleDegraded = useCallback(async () => {
    if (!degraded || accountKind !== "local" || !gateId) return;
    try {
      await resetBiometricGate(gateId);
    } finally {
      await refresh();
    }
  }, [degraded, accountKind, gateId, refresh]);

  // Fail closed in the app: until the app has said the check is off, it is
  // treated as on — except when signed out, where there's nothing to guard.
  const enabledOrUnknown = IS_ANDROID_APP && !!gateId && (status === null || status.enabled);
  const required = enabledOrUnknown && !passed && !degraded;

  return (
    <BiometricGateContext.Provider
      value={{ loading, status, required, verify, markPassed, clearPass, refresh, degraded, settleDegraded }}
    >
      {children}
    </BiometricGateContext.Provider>
  );
}

export function useBiometricGate(): BiometricGateContextValue {
  const context = useContext(BiometricGateContext);
  if (!context) throw new Error("useBiometricGate must be used within a BiometricGateProvider");
  return context;
}
