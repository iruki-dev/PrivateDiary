"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useAccount } from "@/contexts/AccountContext";
import { useSeed } from "@/contexts/SeedContext";
import { LoadingScreen } from "@/components/LoadingState";
import { AccountGateFallback } from "@/components/AccountGateFallback";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAccountGate } from "@/hooks/useAccountGate";
import { usePreferences } from "@/contexts/PreferencesContext";
import { clearDraft, loadDraft, saveDraft } from "@/lib/drafts";
import { TodayLabel } from "@/components/TodayLabel";
import { usePendingEntry } from "@/contexts/PendingEntryContext";
import { haptic } from "@/lib/native/app";
import { Icon } from "@/components/Icon";
import { Toast } from "@/components/Toast";

const draftFormatter = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" });

/**
 * Phase 5 write path (ARCHITECTURE.md §3.2 rule 5): works from any
 * logged-in device using only the recipient's public keys. Deliberately
 * does NOT gate on seedStatus === "unlocked" — publicKeys are available as
 * soon as key issuance is done ("locked" is enough), matching the
 * architecture's "쓰기는 시드/개인키 없이 가능" requirement.
 */
export default function WritePage() {
  const { account, store, closeBackup } = useAccount();
  // Drafts are kept per diary (lib/drafts.ts): the account's uid or the local diary's id.
  const draftOwner = store && !store.readOnly ? store.ownerId : null;
  const { publicKeys, decryptionMethods } = useSeed();
  usePageTitle("오늘의 일기");
  const ready = useAccountGate();

  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set by a successful save; shows the "일기를 저장했어요" toast until it times out.
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  // One-shot message from signup ("첫 일기가 저장되었습니다"), shown once.
  const { notice, setNotice, hasPendingEntry, takePendingEntry } = usePendingEntry();
  const [initialNotice, setInitialNotice] = useState(notice);
  const dismissToast = useCallback(() => {
    setSavedAt(null);
    setInitialNotice(null);
  }, []);
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
    if (!draftOwner || !draftAutosave || draftLoadAttemptedRef.current) return;
    draftLoadAttemptedRef.current = true;
    const draft = loadDraft(draftOwner);
    if (!draft) return;
    // Reading localStorage is a browser-only side effect keyed to the
    // signed-in uid, so it can't be derived during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(draft.text);
    setRestoredDraftAt(draft.savedAt);
  }, [draftOwner, draftAutosave]);

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
    if (!draftOwner || !draftAutosave) return;
    const timer = setTimeout(() => saveDraft(draftOwner, text), 800);
    return () => clearTimeout(timer);
  }, [draftOwner, draftAutosave, text]);

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

  // Grow with the text instead of scrolling inside a fixed box: a diary
  // page should read like a page. CSS min-height keeps it tall when empty.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  async function submit() {
    if (!store || !draftOwner || !publicKeys || !text.trim()) return;
    setSubmitting(true);
    setError(null);
    setSavedAt(null);
    try {
      await store.writeEntry(publicKeys, text);
      setText("");
      // The entry is encrypted and stored; the plaintext copy on this
      // device has no reason to outlive that by even a moment.
      clearDraft(draftOwner);
      setRestoredDraftAt(null);
      setSavedAt(new Date());
      haptic("confirm");
      textareaRef.current?.focus();
    } catch (err) {
      console.error("writeEntry failed", err);
      haptic("reject");
      setError(
        store.kind === "local"
          ? "저장하지 못했어요. 쓴 글은 그대로 있어요. 다시 저장해 주세요."
          : "저장하지 못했어요. 쓴 글은 그대로 있어요. 인터넷 연결을 확인하고 다시 저장해 주세요."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submit();
  }

  function discardDraft() {
    if (!draftOwner) return;
    clearDraft(draftOwner);
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

  if (!ready) return <AccountGateFallback />;

  if (account?.kind === "backup") {
    // The phone's backup of an account only reads (lib/store/backup.ts).
    return (
      <main className="flex flex-1 flex-col items-center px-5 pb-10 pt-6 sm:px-6 sm:py-16">
        <div className="card w-full max-w-md space-y-4">
          <div className="flex gap-3">
            <Icon name="phone" size={22} className="mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-[1.0625rem] font-bold">휴대폰 백업은 읽기만 할 수 있어요</p>
              <p className="muted text-sm">새 일기는 서버에 다시 연결해 로그인한 뒤에 쓸 수 있어요.</p>
            </div>
          </div>
          <div className="space-y-2">
            <Link href="/entries" className="btn-primary w-full">
              백업 읽기
            </Link>
            <button type="button" onClick={closeBackup} className="btn-secondary w-full">
              백업 닫기
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!publicKeys || preferencesLoading) {
    // Also waits on preferencesLoading — rendering before the account's
    // privateWritingMode preference has loaded would default to "off" and
    // briefly show the textarea unblurred, defeating the point of the
    // feature for someone who has it enabled.
    return <LoadingScreen />;
  }

  const missingBackupCodes = decryptionMethods !== null && !decryptionMethods.shamir;
  const toastMessage = error ? null : savedAt ? "일기를 저장했어요" : initialNotice;

  return (
    <main className="flex flex-1 flex-col items-center bg-surface px-5 pb-8 sm:px-6 sm:pb-16">
      <form onSubmit={handleSubmit} className="flex w-full max-w-xl flex-1 flex-col">
        {/* Stays in view however long the entry grows, so 저장 is always one tap away. */}
        <div className="sticky top-0 z-30 -mx-5 flex h-16 items-center justify-between gap-3 bg-surface/95 px-5 backdrop-blur sm:top-14 sm:-mx-6 sm:px-6">
          <span className="faint text-sm font-medium tabular-nums">
            {text.length > 0 ? `${text.length.toLocaleString("ko-KR")}자` : ""}
          </span>
          <button
            type="submit"
            disabled={submitting || !text.trim()}
            className="btn-primary min-h-11 rounded-full px-6 text-[0.9375rem]"
            title="⌘/Ctrl + Enter"
          >
            {submitting ? "저장 중…" : "저장"}
          </button>
        </div>

        <h1 className="title-display pt-1">
          <TodayLabel weekdayClassName="text-ink-4" />
        </h1>

        <div className="mt-4 flex flex-1 flex-col gap-4">
          {error && (
            <p role="alert" className="flex gap-2 rounded-2xl bg-danger-fill px-4 py-3 text-sm leading-relaxed text-danger">
              <Icon name="alert-circle" size={18} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          {restoredDraftAt && (
            <div role="status" className="flex items-center justify-between gap-3 rounded-2xl bg-fill py-2 pl-4 pr-2">
              <p className="text-sm text-ink-2">
                저장하지 않은 글을 불러왔어요 · {draftFormatter.format(restoredDraftAt)}
              </p>
              <button type="button" onClick={discardDraft} className="btn-text min-h-10 shrink-0">
                버리기
              </button>
            </div>
          )}

          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              required
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={8}
              placeholder="오늘 하루는 어땠어요?"
              aria-label="오늘의 일기"
              className={`field-editor transition-[filter] duration-300 ${obscured ? "blur-[5px]" : ""}`}
              style={obscured ? { caretColor: "transparent" } : undefined}
            />
            {privateMode && peekAllowed && text.length > 0 && (
              // Hold-to-reveal, pinned near the bottom of the screen where a
              // thumb rests, rather than up in the corner of a long entry.
              <div className="pointer-events-none sticky bottom-24 flex justify-end pt-3 sm:bottom-6">
                <button
                  type="button"
                  aria-label="누르고 있는 동안 글 보이기"
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
                  className="btn-secondary btn-sm pointer-events-auto min-h-11 shadow-float"
                >
                  <Icon name="eye" size={18} />
                  누르고 있으면 보여요
                </button>
              </div>
            )}
          </div>

          {missingBackupCodes && (
            <p className="note-warn">
              <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
              <span>
                백업 코드가 없어요. 일기 암호를 잊으면 일기장을 열 수 없어요.{" "}
                <Link href="/settings#security" className="link whitespace-nowrap">
                  백업 코드 만들기
                </Link>
              </span>
            </p>
          )}

          <p className="flex items-center gap-1.5 border-t border-line pt-3 text-[0.8125rem] font-medium text-ink-3">
            <Icon name="lock" size={16} strokeWidth={2} />
            {account?.kind === "local" ? "저장하면 이 휴대폰에만 잠가 둬요" : "저장하면 나만 읽을 수 있어요"}
          </p>
        </div>
      </form>

      {toastMessage && (
        <Toast
          message={toastMessage}
          onDismiss={dismissToast}
          action={
            <Link href="/entries" className="btn-text min-h-11 px-3.5 text-on-primary hover:text-on-primary">
              보기
            </Link>
          }
        />
      )}
    </main>
  );
}
