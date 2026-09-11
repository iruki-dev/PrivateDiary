"use client";

import { useEffect, useState } from "react";

/**
 * Shows the 24-word mnemonic exactly once (ARCHITECTURE.md §3.1 step 6 /
 * Phase 4). Never persists the mnemonic anywhere — it only ever exists as a
 * React prop backed by in-memory state in the caller, so a refresh or back
 * navigation naturally destroys it rather than needing special handling
 * here. The beforeunload warning is a courtesy against *accidental* loss
 * before the user has acknowledged saving it.
 */
export function MnemonicReveal({
  mnemonic,
  onConfirm,
  confirmLabel = "저장했습니다",
}: {
  mnemonic: string;
  onConfirm: () => void;
  confirmLabel?: string;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const words = mnemonic.trim().split(/\s+/);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return (
    <div className="w-full max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-semibold">복구 문구 (24단어)</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          이 24단어가 있어야만 일기를 복호화할 수 있습니다. 이 화면은 다시 볼 수 없으며,
          잃어버리면 어떤 방법으로도 복구할 수 없습니다. 안전한 곳에 직접 손으로 적어 보관하세요 —
          스크린샷, 클라우드 저장, 메모 앱 사용은 권장하지 않습니다.
        </p>
      </div>

      <ol className="grid grid-cols-2 gap-x-4 gap-y-2 rounded border border-zinc-300 p-4 font-mono text-sm dark:border-zinc-700 sm:grid-cols-3">
        {words.map((word, index) => (
          <li key={index} className="flex gap-2">
            <span className="w-5 text-right text-zinc-400">{index + 1}.</span>
            <span>{word}</span>
          </li>
        ))}
      </ol>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-1"
        />
        <span>24단어를 안전한 곳에 직접 적어 보관했습니다. 이 화면은 다시 표시되지 않는다는 것을 이해했습니다.</span>
      </label>

      <button
        type="button"
        disabled={!acknowledged}
        onClick={onConfirm}
        className="w-full rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
      >
        {confirmLabel}
      </button>
    </div>
  );
}
