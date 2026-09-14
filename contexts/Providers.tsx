"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "./AuthContext";
import { OtpProvider } from "./OtpContext";
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
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SecurityProvider>
      <AuthProvider>
        <PreferencesProvider>
          <OtpProvider>
            <SeedProvider>{children}</SeedProvider>
          </OtpProvider>
        </PreferencesProvider>
      </AuthProvider>
    </SecurityProvider>
  );
}
