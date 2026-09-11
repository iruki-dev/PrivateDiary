"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "./AuthContext";
import { OtpProvider } from "./OtpContext";
import { PreferencesProvider } from "./PreferencesContext";
import { SeedProvider } from "./SeedContext";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <PreferencesProvider>
        <OtpProvider>
          <SeedProvider>{children}</SeedProvider>
        </OtpProvider>
      </PreferencesProvider>
    </AuthProvider>
  );
}
