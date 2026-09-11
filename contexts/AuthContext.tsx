"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { subscribeToAuthState } from "@/lib/firebase/auth";

/**
 * Tracks Firebase Auth login state only — nothing about the master seed or
 * encryption keys. Kept as its own context, separate from SeedContext,
 * because login and encryption are different concerns that must never be
 * conflated (ARCHITECTURE.md rule 5).
 */

export type AuthStatus = "loading" | "signed-out" | "signed-in";

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<AuthContextValue>({ user: null, status: "loading" });

  useEffect(() => {
    return subscribeToAuthState((user) => {
      setValue({ user, status: user ? "signed-in" : "signed-out" });
    });
  }, []);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
