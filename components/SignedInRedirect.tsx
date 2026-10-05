"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/navigation";

/**
 * Sends a signed-in visitor from a public page to their dashboard. Renders
 * nothing: the public page around it is server-rendered for everyone
 * (crawlers and first paint included), and auth state only exists in the
 * browser, so this can only ever act after hydration.
 */
export function SignedInRedirect() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed-in") {
      router.replace(DEFAULT_SIGNED_IN_PATH);
    }
  }, [status, router]);

  return null;
}
