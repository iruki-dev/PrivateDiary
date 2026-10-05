"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePendingEntry } from "@/contexts/PendingEntryContext";
import { useAuth } from "@/contexts/AuthContext";
import { LoadingState } from "@/components/LoadingState";
import { TodayLabel } from "@/components/TodayLabel";

/**
 * Today's page for someone who isn't signed in — the same writing surface
 * as /write, so the first thing a visitor meets is the product itself.
 * "저장" carries the text (in memory only, see PendingEntryContext) into
 * signup, which saves it as the account's first entry once keys exist.
 */
export function VisitorComposer() {
  const router = useRouter();
  const { status: authStatus } = useAuth();
  const { setPendingEntry } = usePendingEntry();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grows with the text, same as /write.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

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

  // A signed-in visitor is on their way to /write (SignedInRedirect); don't
  // hand them an editor whose 저장 would send them through signup.
  if (authStatus === "signed-in") {
    return <LoadingState label="오늘의 일기로 이동 중..." />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="visitor-entry" className="block">
          <TodayLabel className="text-sm font-medium" />
        </label>
        <textarea
          id="visitor-entry"
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="오늘 하루는 어땠나요?"
          className="field-editor"
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
