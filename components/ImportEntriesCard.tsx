"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useAccount } from "@/contexts/AccountContext";
import { usePreferences } from "@/contexts/PreferencesContext";
import { useSeed } from "@/contexts/SeedContext";
import { unlockExport, WrongPassphraseError, type LockedExportFile } from "@/lib/crypto";
import {
  entriesFromUnlockedExport,
  importAllowance,
  InvalidImportFileError,
  parseImportFile,
  planImport,
  type ImportableEntry,
  type ImportPlan,
} from "@/lib/entries/import";
import { importedRecently, recordImport } from "@/lib/entries/importLog";
import { FileTooLargeError, pickTextFile } from "@/lib/openFile";
import { haptic } from "@/lib/native/app";
import { Icon } from "@/components/Icon";
import { PasswordField } from "@/components/PasswordField";
import { FormError, PanelActions } from "@/components/settings/forms";

type Phase =
  | { kind: "idle" }
  | { kind: "password"; file: LockedExportFile }
  /** `room`: how many the account's daily limit still lets in, worked out when the file was read. */
  | { kind: "planned"; plan: ImportPlan; room: number }
  | { kind: "importing"; done: number; total: number }
  | { kind: "finished"; added: number; skipped: number; remaining: number };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "불러오기": brings entries from an export file into this diary — the
 * JSON export or a locked file (components/ExportEntriesCard). Each entry
 * is encrypted afresh for this diary's own keys as it is written, through
 * the same path a new entry takes (lib/store), keeping the moment it was
 * first written; entries the diary already has are skipped
 * (lib/entries/import.ts), so running it again only adds what's missing.
 *
 * Needs the diary open: skipping duplicates means comparing with what is
 * already in it. Works the same for an account and for the Android app's
 * local diary; the phone's read-only backup can't take new entries.
 *
 * An account's "하루에 쓸 수 있는 일기" still applies — the server removes
 * entries past it (functions/src/entryRateLimit.ts), which would leave
 * gaps — so a file bigger than what's left today is brought in up to that
 * many, and the rest on another day or after raising the limit.
 */
export function ImportEntriesCard({
  existing,
  ready = true,
  onImported,
  onClose,
}: {
  /** The diary's entries, decrypted — to skip what's already there. */
  existing: readonly { createdAt: Date | null; text: string }[];
  /** False while the diary is still opening: a file can't be checked against a partial list. */
  ready?: boolean;
  onImported: (added: number) => void;
  onClose: () => void;
}) {
  const { store, account } = useAccount();
  const { publicKeys } = useSeed();
  const { dailyEntryLimit } = usePreferences();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readOnly = !store || store.readOnly;
  const limit = account?.kind === "cloud" ? dailyEntryLimit : 0;

  function allowance(): number {
    if (!store) return 0;
    const now = Date.now();
    const writtenToday = existing.filter((entry) => entry.createdAt && now - entry.createdAt.getTime() < DAY_MS).length;
    return importAllowance(limit, writtenToday + importedRecently(store.ownerId, now));
  }

  function plan(entries: ImportableEntry[]) {
    setPhase({ kind: "planned", plan: planImport(existing, entries), room: allowance() });
  }

  async function chooseFile() {
    setError(null);
    let picked;
    try {
      picked = await pickTextFile();
    } catch (err) {
      setError(
        err instanceof FileTooLargeError ? "파일이 너무 커요. 내보낸 파일이 맞는지 확인해 주세요." : "파일을 열지 못했어요. 다시 시도해 주세요."
      );
      return;
    }
    if (!picked) return;
    try {
      const parsed = parseImportFile(picked.content);
      if (parsed.kind === "locked") setPhase({ kind: "password", file: parsed.file });
      else plan(parsed.entries);
    } catch (err) {
      setError(
        err instanceof InvalidImportFileError
          ? "PrivateDiary에서 내보낸 JSON 파일이나 잠긴 파일만 불러올 수 있어요."
          : "파일을 읽지 못했어요. 다시 시도해 주세요."
      );
    }
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase.kind !== "password") return;
    setBusy(true);
    setError(null);
    try {
      const content = await unlockExport(phase.file, password);
      setPassword("");
      plan(entriesFromUnlockedExport(content));
    } catch (err) {
      setError(
        err instanceof WrongPassphraseError
          ? "파일 암호를 다시 확인해 주세요."
          : "파일을 읽지 못했어요. 내보낸 파일이 맞는지 확인해 주세요."
      );
    } finally {
      setBusy(false);
    }
  }

  async function runImport(entries: ImportableEntry[], skipped: number, remaining: number) {
    if (!store || !publicKeys) return;
    setError(null);
    setPhase({ kind: "importing", done: 0, total: entries.length });
    let added = 0;
    try {
      for (const entry of entries) {
        await store.writeEntry(publicKeys, entry.text, entry.createdAt ? { createdAt: entry.createdAt } : {});
        added += 1;
        setPhase({ kind: "importing", done: added, total: entries.length });
      }
      haptic("confirm");
      setPhase({ kind: "finished", added, skipped, remaining });
    } catch (err) {
      console.error("import stopped", err);
      haptic("reject");
      setPhase({ kind: "idle" });
      setError(
        added > 0
          ? `일기 ${added}개를 불러온 뒤 멈췄어요. 같은 파일을 다시 불러오면 나머지만 이어서 가져와요.`
          : "불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."
      );
    } finally {
      recordImport(store.ownerId, added);
      if (added > 0) onImported(added);
    }
  }

  if (readOnly) {
    return (
      <div className="card space-y-3">
        <h2 className="title-2">일기 불러오기</h2>
        <p className="muted text-sm">휴대폰 백업은 읽기만 할 수 있어요. 로그인한 뒤 불러와 주세요.</p>
        <button type="button" onClick={onClose} className="btn-text">
          닫기
        </button>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <div className="space-y-1">
        <h2 className="title-2">일기 불러오기</h2>
        <p className="muted text-sm">
          내보낸 JSON 파일이나 잠긴 파일에서 일기를 가져와요. 쓴 날짜는 그대로이고, 이미 있는 일기는 건너뛰어요.
        </p>
      </div>

      {phase.kind === "idle" && (
        <>
          {!ready && (
            <p className="muted text-sm">아직 일기를 여는 중이에요. 다 열려야 이미 있는 일기를 건너뛸 수 있어요.</p>
          )}
          <FormError>{error}</FormError>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void chooseFile()} disabled={!ready} className="btn-secondary">
              <Icon name="upload" size={18} />
              파일 고르기
            </button>
            <button type="button" onClick={onClose} className="btn-text">
              닫기
            </button>
          </div>
        </>
      )}

      {phase.kind === "password" && (
        <form onSubmit={(event) => void unlock(event)} className="space-y-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Icon name="lock" size={16} strokeWidth={2} />
            잠긴 파일이에요
          </p>
          <PasswordField label="파일 암호" autoComplete="passphrase" autoFocus value={password} onChange={setPassword} />
          <FormError>{error}</FormError>
          <PanelActions
            submitLabel="파일 열기"
            busyLabel="여는 중…"
            busy={busy}
            onCancel={() => {
              setPassword("");
              setError(null);
              setPhase({ kind: "idle" });
            }}
          />
        </form>
      )}

      {phase.kind === "planned" &&
        (() => {
          const { toAdd, skipped } = phase.plan;
          const { room } = phase;
          const now = toAdd.slice(0, Math.min(toAdd.length, room));
          const later = toAdd.length - now.length;
          if (toAdd.length === 0) {
            return (
              <div className="space-y-3">
                <p className="success-text flex gap-2">
                  <Icon name="check-circle" size={18} className="mt-0.5 shrink-0" />
                  새로 불러올 일기가 없어요. 파일의 일기 {skipped}개가 모두 일기장에 있어요.
                </p>
                <button type="button" onClick={onClose} className="btn-secondary w-full">
                  닫기
                </button>
              </div>
            );
          }
          return (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void runImport(now, skipped, later);
              }}
              className="space-y-3"
            >
              <p className="text-[0.9375rem]">
                새 일기 <b className="tabular-nums">{toAdd.length.toLocaleString("ko-KR")}개</b>를 불러와요.
                {skipped > 0 && ` 이미 있는 ${skipped.toLocaleString("ko-KR")}개는 건너뛰어요.`}
              </p>
              {later > 0 && (
                <p className="note-warn">
                  <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
                  <span>
                    하루에 쓸 수 있는 일기가 {limit}개로 정해져 있어서 오늘은 {now.length}개까지만 불러올 수 있어요. 나머지는
                    내일 같은 파일을 다시 불러오거나,{" "}
                    <Link href="/settings#writing" className="link">
                      설정
                    </Link>
                    에서 제한을 바꾼 뒤 불러와 주세요.
                  </span>
                </p>
              )}
              <PanelActions
                submitLabel={later > 0 ? `${now.length}개 불러오기` : "불러오기"}
                busy={now.length === 0}
                onCancel={() => setPhase({ kind: "idle" })}
              />
            </form>
          );
        })()}

      {phase.kind === "importing" && (
        <div className="space-y-2" role="status">
          <p className="text-[0.9375rem] font-semibold">일기를 불러오는 중…</p>
          <div
            role="progressbar"
            aria-label="불러오기 진행"
            aria-valuemin={0}
            aria-valuemax={phase.total}
            aria-valuenow={phase.done}
            className="h-1.5 overflow-hidden rounded-full bg-fill"
          >
            <div className="h-full bg-ink transition-[width]" style={{ width: `${(phase.done / Math.max(1, phase.total)) * 100}%` }} />
          </div>
          <p className="text-sm text-ink-3">화면을 닫지 말고 기다려 주세요. 하나씩 잠가서 저장해요.</p>
        </div>
      )}

      {phase.kind === "finished" && (
        <div className="space-y-3">
          <p role="status" className="success-text flex gap-2">
            <Icon name="check-circle" size={18} className="mt-0.5 shrink-0" />
            일기 {phase.added.toLocaleString("ko-KR")}개를 불러왔어요.
            {phase.remaining > 0 && ` 남은 ${phase.remaining.toLocaleString("ko-KR")}개는 같은 파일을 다시 불러오면 이어서 가져와요.`}
          </p>
          <button type="button" onClick={onClose} className="btn-secondary w-full">
            닫기
          </button>
        </div>
      )}
    </div>
  );
}
