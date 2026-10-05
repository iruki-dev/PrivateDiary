"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * App Router error boundary — without this, an uncaught render error would
 * fall through to Next.js's default (unstyled, English) error screen. This
 * never sees plaintext or key material by construction (ARCHITECTURE.md
 * rule 1): a render crash happens in the UI layer, after lib/crypto has
 * already returned a value or an error object, and `error` is only ever
 * logged to the browser console.
 */
export default function GlobalError({ error, retry }: { error: Error; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="page-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">화면을 표시하지 못했습니다</h1>
          <p className="muted">일시적인 문제일 수 있습니다. 저장한 일기는 안전합니다.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => retry()} className="btn-primary flex-1">
            다시 시도
          </button>
          <Link href="/" className="btn-secondary">
            처음으로
          </Link>
        </div>
      </div>
    </main>
  );
}
