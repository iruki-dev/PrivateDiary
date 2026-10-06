"use client";

import type { ReactNode } from "react";
import { AccountProvider } from "./AccountContext";
import { AuthProvider } from "./AuthContext";
import { BiometricGateProvider } from "./BiometricGateContext";
import { NativeProvider } from "./NativeContext";
import { OtpProvider } from "./OtpContext";
import { PendingEntryProvider } from "./PendingEntryContext";
import { PreferencesProvider } from "./PreferencesContext";
import { SecurityProvider } from "./SecurityContext";
import { SeedProvider } from "./SeedContext";

/**
 * SecurityProvider sits outside everything else, deliberately: it has
 * nothing to do with being signed in (contexts/SecurityContext.tsx starts
 * watching from the very first render regardless of auth state), and
 * importing it here is what makes lib/security/nativeIntegrity.ts's
 * module-load-time reference snapshot run as early as this app's own JS
 * can run at all — see that module's doc comment for why that timing
 * matters.
 *
 * AccountProvider sits right under AuthProvider: everything below works
 * with "the diary that is open" (a cloud account, the local diary, or the
 * phone's copy of an account) rather than with the Firebase user directly.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SecurityProvider>
      <AuthProvider>
        <AccountProvider>
          <NativeProvider>
            <BiometricGateProvider>
              <PreferencesProvider>
                <OtpProvider>
                  <SeedProvider>
                    <PendingEntryProvider>{children}</PendingEntryProvider>
                  </SeedProvider>
                </OtpProvider>
              </PreferencesProvider>
            </BiometricGateProvider>
          </NativeProvider>
        </AccountProvider>
      </AuthProvider>
    </SecurityProvider>
  );
}
