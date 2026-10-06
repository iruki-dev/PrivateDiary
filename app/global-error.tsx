"use client";

import "./globals.css";

/**
 * Last-resort boundary for errors in the root layout itself (the provider
 * tree, the nav). It replaces the whole document, so it brings its own
 * <html>/<body> and the global stylesheet, and can't rely on any context.
 */
export default function RootError({ retry }: { error: Error; retry: () => void }) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <title>문제가 생겼어요 · PrivateDiary</title>
        <main className="page-center">
          <div className="w-full max-w-sm space-y-6">
            <div className="space-y-2">
              <h1 className="title-1">PrivateDiary를 불러오지 못했어요</h1>
              <p className="muted text-base">잠깐 생긴 문제일 수 있어요. 저장한 일기는 안전해요.</p>
            </div>
            <button type="button" onClick={() => retry()} className="btn-primary w-full">
              다시 시도
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
