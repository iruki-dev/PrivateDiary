"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePendingEntry } from "@/contexts/PendingEntryContext";
import { TodayLabel } from "@/components/TodayLabel";

/**
 * Today's page for someone who isn't signed in — the same writing surface
 * as /write, so the first thing a visitor meets is the product itself.
 * "저장" carries the text (in memory only, see PendingEntryContext) into
 * signup, which saves it as the account's first entry once keys exist.
 */
export function VisitorComposer() {
  const router = useRouter();
  const { setPendingEntry } = usePendingEntry();
  const [text, setText] = useState("");

  // Same guard as /write: don't lose a half-written entry to a stray
  // refresh or tab close.
  useEffect(() => {
    if (!text.trim()) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [text]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) return;
    setPendingEntry(text);
    router.push("/signup");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="visitor-entry" className="block">
          <TodayLabel className="text-sm font-medium" />
        </label>
        <textarea
          id="visitor-entry"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder="오늘 하루는 어땠나요?"
          className="field min-h-48 resize-y"
        />
        <p className="faint text-right text-xs" aria-live="polite">
          {text.length.toLocaleString("ko-KR")}자
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="submit" disabled={!text.trim()} className="btn-primary">
          저장
        </button>
        <p className="faint text-xs">저장하려면 계정이 필요합니다. 쓴 글은 가입 후 첫 일기로 저장됩니다.</p>
      </div>
      <p className="text-sm">
        <Link href="/signup" className="link">
          글 없이 가입하기
        </Link>
      </p>
    </form>
  );
}
