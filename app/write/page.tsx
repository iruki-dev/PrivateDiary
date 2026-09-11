"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useSeed } from "@/contexts/SeedContext";
import { writeEntry } from "@/lib/firebase/entries";
import { LoadingScreen } from "@/components/LoadingState";
import { usePageTitle } from "@/hooks/usePageTitle";
import { usePreferences } from "@/contexts/PreferencesContext";

/** Minimal outline eye glyph — no icon library in this codebase, and this is the only icon needed. */
function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/**
 * Phase 5 write path (ARCHITECTURE.md §3.2 rule 5): works from any
 * logged-in device using only the recipient's public keys. Deliberately
 * does NOT gate on seedStatus === "unlocked" — publicKeys are available as
 * soon as key issuance is done ("locked" is enough), matching the
 * architecture's "쓰기는 시드/개인키 없이 가능" requirement.
 */
export default function WritePage() {
  const { user, status: authStatus } = useAuth();
  const { status: seedStatus, publicKeys } = useSeed();
  const router = useRouter();
  usePageTitle("오늘의 일기");

  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    loading: preferencesLoading,
    privateWritingMode: privateMode,
    privateWritingPeekAllowed: peekAllowed,
  } = usePreferences();
  // Hold-to-reveal, not a toggle: true only while the icon below is
  // actively pressed. Resets to hidden on every mount/reload, which is
  // the safer default for a "someone might be next to me" feature. When
  // peekAllowed is false the icon isn't rendered at all (see below), so
  // this can never become true — there is then no way to un-blur the
  // text by any means, per /settings' "확인 아이콘" toggle.
  const [revealing, setRevealing] = useState(false);
  const obscured = privateMode && !revealing;

  useEffect(() => {
    if (authStatus === "signed-in" && seedStatus === "not-issued") {
      router.replace("/signup");
    }
  }, [authStatus, seedStatus, router]);

  // Warns before closing/refreshing the tab with unsaved text — losing a
  // half-written diary entry to an accidental tab close is a real, common
  // way to lose work that's worth a native confirm prompt for.
  useEffect(() => {
    if (!text.trim()) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [text]);

  async function submit() {
    if (!user || !publicKeys || !text.trim()) return;
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      await writeEntry(user.uid, publicKeys, text);
      setText("");
      setSuccess(true);
      textareaRef.current?.focus();
    } catch {
      setError("저장하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter to save without reaching for the mouse — the textarea
    // itself swallows plain Enter (it's a newline), so this is the natural
    // "I'm done" shortcut for a writing-focused page.
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  }

  if (authStatus !== "signed-in" || !publicKeys || preferencesLoading) {
    // Also waits on preferencesLoading — rendering before the account's
    // privateWritingMode preference has loaded would default to "off" and
    // briefly show the textarea unblurred, defeating the point of the
    // feature for someone who has it enabled.
    return <LoadingScreen />;
  }

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-10 sm:px-6 sm:py-16">
      <form onSubmit={handleSubmit} className="w-full max-w-xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">오늘의 일기</h1>
          <Link href="/entries" className="text-sm link">
            지난 일기 보기
          </Link>
        </div>
        <div className="space-y-1">
          <div className="relative">
            <textarea
              ref={textareaRef}
              required
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={12}
              placeholder="오늘 하루는 어땠나요?"
              aria-label="오늘의 일기 내용"
              className={`field min-h-48 resize-y transition-[filter] duration-300 ${
                obscured ? "blur-[4px]" : ""
              }`}
              style={obscured ? { caretColor: "transparent" } : undefined}
            />
            {privateMode && peekAllowed && (
              <button
                type="button"
                aria-label="누르고 있는 동안 잠시 보기"
                aria-pressed={revealing}
                onPointerDown={() => setRevealing(true)}
                onPointerUp={() => setRevealing(false)}
                onPointerLeave={() => setRevealing(false)}
                onPointerCancel={() => setRevealing(false)}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    setRevealing(true);
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === " " || e.key === "Enter") setRevealing(false);
                }}
                className="absolute right-2 top-2 rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/50 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                <EyeIcon className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="text-right text-xs text-zinc-400" aria-live="polite">
            {text.length.toLocaleString("ko-KR")}자
          </p>
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="success-text">
            저장되었습니다.
          </p>
        )}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={submitting || !text.trim()} className="btn-primary">
            {submitting ? "저장 중..." : "저장"}
          </button>
          <span className="hidden text-xs text-zinc-400 sm:inline">⌘/Ctrl + Enter로도 저장할 수 있습니다</span>
        </div>
      </form>
    </main>
  );
}
