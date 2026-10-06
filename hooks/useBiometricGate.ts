"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { IS_ANDROID_APP } from "@/lib/platform";
import { isNativeApp } from "@/lib/native/bridge";
import { biometricGateStatus, type BiometricGateStatus } from "@/lib/native/app";

/**
 * The biometric check's state for the signed-in account on this phone
 * (Android app only). `status` stays null on the website, and while loading.
 */
export function useBiometricGate(): { status: BiometricGateStatus | null; refresh: () => Promise<void> } {
  const { user } = useAuth();
  const [status, setStatus] = useState<BiometricGateStatus | null>(null);

  const refresh = useCallback(async () => {
    if (!IS_ANDROID_APP || !user || !isNativeApp()) return;
    try {
      setStatus(await biometricGateStatus(user.uid));
    } catch {
      setStatus(null);
    }
  }, [user]);

  useEffect(() => {
    // Asks the app (an async bridge call) — can't be derived during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return { status, refresh };
}
