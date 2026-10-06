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
    return <LoadingState label="" />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-3 rounded-3xl bg-surface px-5 pb-4 pt-5 sm:px-6">
        <label htmlFor="visitor-entry" className="block title-2">
          <TodayLabel weekdayClassName="text-ink-4" />
        </label>
        <textarea
          id="visitor-entry"
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="오늘 하루는 어땠어요?"
          className="field-editor"
        />
        <p className="faint border-t border-line pt-3 text-right text-[0.8125rem] font-medium tabular-nums">
          {text.length.toLocaleString("ko-KR")}자
        </p>
      </div>
      <div className="space-y-3">
        <button type="submit" disabled={!text.trim()} className="btn-primary min-h-14 w-full rounded-2xl text-[1.0625rem]">
          저장하고 가입하기
        </button>
        <p className="faint text-center text-sm">쓴 글은 가입을 마치면 첫 일기로 저장돼요.</p>
      </div>
      <p className="text-center">
        <Link href="/signup" className="btn-text">
          글 없이 가입하기
        </Link>
      </p>
    </form>
  );
}
