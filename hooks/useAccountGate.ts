"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAccount } from "@/contexts/AccountContext";
import { useSeed } from "@/contexts/SeedContext";
import { loginPathFor } from "@/lib/navigation";

/**
 * Shared entry guard for every page that needs a finished diary.
 *
 * Signed out → /login, carrying this page as `?next=` so the visitor lands
 * back where they were headed. Before this, each page only rendered its
 * loading screen while `authStatus !== "signed-in"` and never left it, so
 * opening a bookmarked /write or a home-screen shortcut after signing out
 * spun "확인 중..." forever.
 *
 * Signed in without issued keys → /signup to finish onboarding, or /local
 * for the Android app's fully local diary, which is set up there.
 *
 * Returns true once the page may render its real content. While it is
 * false, pages render <AccountGateFallback />, which also covers a key
 * record that couldn't be read (the server unreachable).
 */
export function useAccountGate(): boolean {
  const { status: accountStatus, account } = useAccount();
  const { status: seedStatus } = useSeed();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (accountStatus === "signed-out") {
      router.replace(loginPathFor(pathname));
    } else if (accountStatus === "signed-in" && seedStatus === "not-issued") {
      router.replace(account?.kind === "local" ? "/local" : "/signup");
    }
  }, [accountStatus, seedStatus, account?.kind, router, pathname]);

  return accountStatus === "signed-in" && seedStatus !== "unknown" && seedStatus !== "not-issued";
}
