"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "./AuthContext";
import { SeedProvider } from "./SeedContext";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <SeedProvider>{children}</SeedProvider>
    </AuthProvider>
  );
}
