"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useSeed } from "@/contexts/SeedContext";
import { loginPathFor } from "@/lib/navigation";

/**
 * Shared entry guard for every page that needs a finished account.
 *
 * Signed out → /login, carrying this page as `?next=` so the visitor lands
 * back where they were headed. Before this, each page only rendered its
 * loading screen while `authStatus !== "signed-in"` and never left it, so
 * opening a bookmarked /write or a home-screen shortcut after signing out
 * spun "확인 중..." forever.
 *
 * Signed in without issued keys → /signup, to finish onboarding (this was
 * already duplicated as an effect in each page; it lives here now).
 *
 * Returns true once the page may render its real content.
 */
export function useAccountGate(): boolean {
  const { status: authStatus } = useAuth();
  const { status: seedStatus } = useSeed();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (authStatus === "signed-out") {
      router.replace(loginPathFor(pathname));
    } else if (authStatus === "signed-in" && seedStatus === "not-issued") {
      router.replace("/signup");
    }
  }, [authStatus, seedStatus, router, pathname]);

  return authStatus === "signed-in" && seedStatus !== "unknown" && seedStatus !== "not-issued";
}
