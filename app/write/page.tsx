"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSeed } from "@/contexts/SeedContext";
import { writeEntry } from "@/lib/firebase/entries";
import { LoadingScreen } from "@/components/LoadingState";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAccountGate } from "@/hooks/useAccountGate";
import { usePreferences } from "@/contexts/PreferencesContext";
import { clearDraft, loadDraft, saveDraft } from "@/lib/drafts";
import { TodayLabel } from "@/components/TodayLabel";
import { usePendingEntry } from "@/contexts/PendingEntryContext";

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
  const { user } = useAuth();
  const { publicKeys } = useSeed();
  usePageTitle("오늘의 일기");
  const ready = useAccountGate();

  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // One-shot message from signup ("첫 일기가 저장되었습니다"), shown once.
  const { notice, setNotice, hasPendingEntry, takePendingEntry } = usePendingEntry();
  const [initialNotice] = useState(notice);
  useEffect(() => {
    if (notice) setNotice(null);
  }, [notice, setNotice]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    loading: preferencesLoading,
    privateWritingMode: privateMode,
    privateWritingPeekAllowed: peekAllowed,
    draftAutosave,
  } = usePreferences();
  // Hold-to-reveal, not a toggle: true only while the icon below is
  // actively pressed. Resets to hidden on every mount/reload, which is
  // the safer default for a "someone might be next to me" feature. When
  // peekAllowed is false the icon isn't rendered at all (see below), so
  // this can never become true — there is then no way to un-blur the
  // text by any means, per /settings' "확인 아이콘" toggle.
  const [revealing, setRevealing] = useState(false);
  const obscured = privateMode && !revealing;

  // Crash safety for in-progress writing (lib/drafts.ts). Off by default
  // and opt-in from /settings, because it is the one thing in this app
  // that puts plaintext on disk.
  const [restoredDraftAt, setRestoredDraftAt] = useState<Date | null>(null);
  const draftLoadAttemptedRef = useRef(false);

  // Restore a draft left behind by a crash or a closed tab. Runs once per
  // mount: after this, `text` is whatever the user is currently typing, and
  // re-running would clobber it with a stale copy.
  useEffect(() => {
    if (!user || !draftAutosave || draftLoadAttemptedRef.current) return;
    draftLoadAttemptedRef.current = true;
    const draft = loadDraft(user.uid);
    if (!draft) return;
    // Reading localStorage is a browser-only side effect keyed to the
    // signed-in uid, so it can't be derived during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(draft.text);
    setRestoredDraftAt(draft.savedAt);
  }, [user, draftAutosave]);

  // An entry written on "/" before signing up that signup couldn't save
  // (see app/signup/page.tsx) — put it back in the editor, not lost.
  useEffect(() => {
    if (!hasPendingEntry) return;
    const pending = takePendingEntry();
    // Taking it out of the in-memory hand-off is a one-time side effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (pending) setText(pending);
  }, [hasPendingEntry, takePendingEntry]);

  // Debounced so a fast typist isn't writing to localStorage on every
  // keystroke. The cleanup cancels the pending write, which also means the
  // empty-text write scheduled on mount never lands if a draft restores
  // first — otherwise restoring would immediately erase what it restored.
  useEffect(() => {
    if (!user || !draftAutosave) return;
    const timer = setTimeout(() => saveDraft(user.uid, text), 800);
    return () => clearTimeout(timer);
  }, [user, draftAutosave, text]);

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
      // The entry is encrypted and stored; the plaintext copy on this
      // device has no reason to outlive that by even a moment.
      clearDraft(user.uid);
      setRestoredDraftAt(null);
      setSuccess(true);
      textareaRef.current?.focus();
    } catch (err) {
      console.error("writeEntry failed", err);
      setError("저장하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submit();
  }

  function discardDraft() {
    if (!user) return;
    clearDraft(user.uid);
    setText("");
    setRestoredDraftAt(null);
    textareaRef.current?.focus();
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

  if (!ready || !publicKeys || preferencesLoading) {
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
          <h1 className="text-xl font-semibold">
            <TodayLabel />
          </h1>
        </div>
        {restoredDraftAt && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
          >
            <p className="muted text-xs">
              저장하지 않고 닫은 글을 이 기기에서 불러왔습니다 (
              {new Intl.DateTimeFormat("ko-KR", {
                dateStyle: "short",
                timeStyle: "short",
              }).format(restoredDraftAt)}
              ).
            </p>
            <button type="button" onClick={discardDraft} className="text-xs link">
              버리기
            </button>
          </div>
        )}
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
          <p className="faint text-right text-xs" aria-live="polite">
            {text.length.toLocaleString("ko-KR")}자
          </p>
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {initialNotice && !success && (
          <p role="status" className="success-text">
            {initialNotice}
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
          <span className="faint hidden text-xs sm:inline">⌘/Ctrl + Enter로도 저장할 수 있습니다</span>
        </div>
      </form>
    </main>
  );
}
