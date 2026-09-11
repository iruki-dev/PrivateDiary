"use client";

import { useEffect } from "react";

/**
 * App Router error boundary — without this, an uncaught render error would
 * fall through to Next.js's default (unstyled, English) error screen,
 * breaking out of the app's design entirely. This never sees plaintext or
 * key material by construction (ARCHITECTURE.md rule 1): a render crash
 * happens in the UI layer, well after lib/crypto has already returned
 * either a value or an error object, and nothing here logs `error` anywhere
 * but the browser console.
 */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="page-center flex-col gap-3 text-center">
      <h1 className="text-xl font-semibold">문제가 발생했습니다</h1>
      <p className="muted">페이지를 표시하는 중 오류가 발생했습니다.</p>
      <button type="button" onClick={() => reset()} className="btn-primary mt-2">
        다시 시도
      </button>
    </main>
  );
}
