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
          <h1 className="title-1">화면을 보여 드리지 못했어요</h1>
          <p className="muted text-base">잠깐 생긴 문제일 수 있어요. 저장한 일기는 안전해요.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => retry()} className="btn-primary">
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
