"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { onIdTokenChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase/config";
import {
  confirmOtpSetup,
  disableOtp as disableOtpCall,
  startOtpSetup,
  verifyOtp as verifyOtpCall,
  verifyShamirOtpBypass as verifyShamirOtpBypassCall,
  type OtpSetupMaterial,
} from "@/lib/firebase/otp";

/**
 * Tracks OTP (TOTP authenticator app) status from the signed-in user's own
 * Firebase Auth ID token claims — `otpEnabled` / `otpVerified` /
 * `otpVerifiedAt`, set only by functions/src/index.ts via the Admin SDK
 * (see firestore.rules' otpSatisfied()). This context deliberately sits
 * between AuthContext and SeedContext in the provider tree
 * (contexts/Providers.tsx): OTP is an access gate on top of login, wholly
 * separate from the seed/passphrase state SeedContext owns.
 *
 * `otpVerified` here mirrors firestore.rules' 12h session window
 * client-side so the UI can show the right gate proactively — the rules
 * check is what's actually authoritative; this is just so the app doesn't
 * have to wait for a failed Firestore read to find out.
 */

const OTP_SESSION_MS = 12 * 60 * 60 * 1000;

interface OtpContextValue {
  loading: boolean;
  otpEnabled: boolean;
  otpVerified: boolean;
  /** Verifies `code` for this session. Throws IncorrectOtpCodeError / OtpLockedOutError on failure. */
  verify: (code: string) => Promise<void>;
  /**
   * Satisfies the OTP gate for this session using a Shamir OTP-bypass
   * proof instead of a TOTP code — see lib/firebase/otp.ts. Throws
   * ShamirOtpBypassFailedError / ShamirNotConfiguredError on failure.
   */
  verifyViaShamirBypass: (proof: string) => Promise<void>;
  /** Starts OTP setup — generates a secret + otpauth:// URI to show as a QR code. */
  startSetup: () => Promise<OtpSetupMaterial>;
  /** Confirms setup with one valid code from the freshly-scanned authenticator app. */
  confirmSetup: (code: string) => Promise<void>;
  /** Disables OTP. Requires a currently-valid code. */
  disable: (code: string) => Promise<void>;
}

const OtpContext = createContext<OtpContextValue | undefined>(undefined);

export function OtpProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [otpEnabled, setOtpEnabled] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);

  const applyClaims = useCallback((user: User | null, claims: Record<string, unknown>) => {
    if (!user) {
      setOtpEnabled(false);
      setOtpVerified(false);
      return;
    }
    const enabled = claims.otpEnabled === true;
    const verifiedAt = typeof claims.otpVerifiedAt === "number" ? claims.otpVerifiedAt : 0;
    setOtpEnabled(enabled);
    setOtpVerified(claims.otpVerified === true && Date.now() - verifiedAt < OTP_SESSION_MS);
  }, []);

  useEffect(() => {
    return onIdTokenChanged(auth, async (user) => {
      if (!user) {
        applyClaims(null, {});
        setLoading(false);
        return;
      }
      const result = await user.getIdTokenResult();
      applyClaims(user, result.claims);
      setLoading(false);
    });
  }, [applyClaims]);

  const refreshClaims = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    const result = await user.getIdTokenResult(true); // force refresh from the server
    applyClaims(user, result.claims);
  }, [applyClaims]);

  const verify = useCallback(
    async (code: string) => {
      await verifyOtpCall(code);
      await refreshClaims();
    },
    [refreshClaims]
  );

  const verifyViaShamirBypass = useCallback(
    async (proof: string) => {
      await verifyShamirOtpBypassCall(proof);
      await refreshClaims();
    },
    [refreshClaims]
  );

  const startSetup = useCallback(() => startOtpSetup(), []);

  const confirmSetup = useCallback(
    async (code: string) => {
      await confirmOtpSetup(code);
      await refreshClaims();
    },
    [refreshClaims]
  );

  const disable = useCallback(
    async (code: string) => {
      await disableOtpCall(code);
      await refreshClaims();
    },
    [refreshClaims]
  );

  return (
    <OtpContext.Provider
      value={{
        loading,
        otpEnabled,
        otpVerified,
        verify,
        verifyViaShamirBypass,
        startSetup,
        confirmSetup,
        disable,
      }}
    >
      {children}
    </OtpContext.Provider>
  );
}

export function useOtp(): OtpContextValue {
  const context = useContext(OtpContext);
  if (!context) {
    throw new Error("useOtp must be used within an OtpProvider");
  }
  return context;
}
