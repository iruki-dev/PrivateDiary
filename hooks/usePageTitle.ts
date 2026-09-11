"use client";

import { useEffect } from "react";

/**
 * Every page here is a client component (see app/layout.tsx's force-dynamic
 * doc comment — CSP nonce requirements rule out static/server metadata
 * exports), so per-route <title> can't use Next.js's `metadata` export.
 * This is the client-side equivalent: distinguishes browser tabs when
 * several routes are open at once instead of every tab reading "PrivateDiary".
 */
export function usePageTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · PrivateDiary`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
