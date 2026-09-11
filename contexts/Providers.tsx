"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "./AuthContext";
import { OtpProvider } from "./OtpContext";
import { SeedProvider } from "./SeedContext";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <OtpProvider>
        <SeedProvider>{children}</SeedProvider>
      </OtpProvider>
    </AuthProvider>
  );
}
