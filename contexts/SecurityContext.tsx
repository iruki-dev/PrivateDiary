"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { checkNativeIntegrity } from "@/lib/security/nativeIntegrity";
import { IS_ANDROID_APP } from "@/lib/platform";
import { nativeHello } from "@/lib/native/bridge";
import {
  collectSyncEnvironmentWarnings,
  deviceWarnings,
  devtoolsWarning,
  probeDevtoolsOpen,
  type EnvironmentWarning,
} from "@/lib/security/environmentSignals";

/**
 * Session-wide view of lib/security's checks (see nativeIntegrity.ts and
 * environmentSignals.ts for what each signal means and why it's split
 * into "block" vs. "warn" severity). Deliberately the OUTERMOST provider
 * in contexts/Providers.tsx — this has nothing to do with being signed in,
 * and should be watching from the first possible render regardless of
 * auth state.
 *
 * `tamperedApis` mirrors what lib/crypto call sites independently already
 * enforce via assertNativeIntegrity() (contexts/SeedContext.tsx,
 * lib/firebase/entries.ts) — this context doesn't gate anything itself,
 * it only gives the UI (components/SecurityWarningBanner.tsx) something
 * to render BEFORE the user hits a guarded action, not only after.
 */

const INTEGRITY_POLL_MS = 5_000;
const DEVTOOLS_POLL_MS = 3_000;

interface SecurityContextValue {
  /** Non-empty means a security-critical API has been tampered with (lib/security/nativeIntegrity.ts). Not dismissible by design — see SecurityWarningBanner. */
  tamperedApis: string[];
  /** Softer, per-kind-dismissible signals (lib/security/environmentSignals.ts). */
  warnings: EnvironmentWarning[];
  dismissWarning: (kind: EnvironmentWarning["kind"]) => void;
}

const SecurityContext = createContext<SecurityContextValue | undefined>(undefined);

export function SecurityProvider({ children }: { children: ReactNode }) {
  const [tamperedApis, setTamperedApis] = useState<string[]>([]);
  const [syncWarnings, setSyncWarnings] = useState<EnvironmentWarning[]>([]);
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  const [phoneWarnings, setPhoneWarnings] = useState<EnvironmentWarning[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<EnvironmentWarning["kind"]>>(new Set());

  useEffect(() => {
    function runIntegrityCheck() {
      setTamperedApis(checkNativeIntegrity().tampered);
      setSyncWarnings(collectSyncEnvironmentWarnings());
    }
    // Runs once immediately (not just on the first interval tick) and
    // again whenever the tab regains focus — an extension can be
    // installed/enabled, or inject late, while this tab was backgrounded.
    runIntegrityCheck();
    const integrityTimer = setInterval(runIntegrityCheck, INTEGRITY_POLL_MS);
    function onVisibilityChange() {
      if (document.visibilityState === "visible") runIntegrityCheck();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(integrityTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // Android app: the phone's own state, reported once by the app.
  useEffect(() => {
    if (!IS_ANDROID_APP) return;
    let cancelled = false;
    void nativeHello().then((hello) => {
      if (!cancelled && hello) setPhoneWarnings(deviceWarnings(hello.signals));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // The app's release build has no way to open DevTools at all
    // (MainActivity only enables WebView inspection in debug builds).
    if (IS_ANDROID_APP) return;
    let cancelled = false;
    async function pollDevtools() {
      const open = await probeDevtoolsOpen();
      if (!cancelled) setDevtoolsOpen(open);
    }
    void pollDevtools();
    const timer = setInterval(() => void pollDevtools(), DEVTOOLS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const dismissWarning = useCallback((kind: EnvironmentWarning["kind"]) => {
    setDismissed((prev) => new Set(prev).add(kind));
  }, []);

  const allWarnings = [...syncWarnings, ...phoneWarnings, ...(devtoolsOpen ? [devtoolsWarning()] : [])].filter(
    (warning) => !dismissed.has(warning.kind)
  );

  return (
    <SecurityContext.Provider value={{ tamperedApis, warnings: allWarnings, dismissWarning }}>
      {children}
    </SecurityContext.Provider>
  );
}

export function useSecurity(): SecurityContextValue {
  const context = useContext(SecurityContext);
  if (!context) {
    throw new Error("useSecurity must be used within a SecurityProvider");
  }
  return context;
}
