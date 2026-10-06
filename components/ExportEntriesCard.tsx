"use client";

import { useState, type FormEvent } from "react";
import { buildExportFile, lockedExportFilename, type ExportFormat, type ExportableEntry } from "@/lib/entries/export";
import { lockExport } from "@/lib/crypto";
import { checkPassphraseStrength } from "@/lib/passphraseStrength";
import { saveTextFile } from "@/lib/saveFile";
import { Icon } from "@/components/Icon";
import { PasswordField } from "@/components/PasswordField";
import { PassphraseStrengthMeter } from "@/components/PassphraseStrengthMeter";
import { FormError, PanelActions } from "@/components/settings/forms";

/**
 * "Download my diary", available once the session is unlocked.
 *
 * This is the counterweight to ARCHITECTURE.md §3.6 rule 5 / §9: an app
 * that will genuinely and permanently destroy your writing if you forget
 * one passphrase owes you a copy you can keep yourself. Without it,
 * "zero-knowledge" quietly also means "no way out".
 *
 * Two kinds of copy:
 *
 *  - Markdown / JSON: plaintext by construction — an archive that outlives
 *    this app and its keys — so the warning is stated up front rather than
 *    buried, and the download takes a second, deliberate click.
 *  - A locked file (lib/crypto/archive.ts): the JSON export under a
 *    password chosen for the file, held to the same strength rule as the
 *    diary passphrase since anyone holding the file can guess at it
 *    offline. It can be brought back into any diary with 불러오기
 *    (components/ImportEntriesCard), and opened nowhere else.
 */
export function ExportEntriesCard({
  entries,
  disabled,
  disabledReason,
  onClose,
}: {
  entries: readonly ExportableEntry[];
  disabled?: boolean;
  disabledReason?: string;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  async function download(format: ExportFormat) {
    setError(null);
    setSaved(null);
    try {
      const file = buildExportFile(entries, format);
      await saveTextFile(file.filename, file.mimeType, file.content);
    } catch (err) {
      console.error("export failed", err);
      setError("파일을 만들지 못했어요. 다시 시도해 주세요.");
    }
  }

  async function downloadLocked(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(null);
    if (password !== confirm) {
      setError("두 칸에 같은 파일 암호를 넣어 주세요.");
      return;
    }
    if (!checkPassphraseStrength(password).isStrongEnough) {
      setError("파일 암호가 너무 짧아요. 서로 상관없는 단어를 더 이어 붙여 보세요.");
      return;
    }
    setBusy(true);
    try {
      const plain = buildExportFile(entries, "json");
      const locked = await lockExport(plain.content, password);
      const ok = await saveTextFile(lockedExportFilename(), "application/json;charset=utf-8", JSON.stringify(locked));
      if (ok) {
        setPassword("");
        setConfirm("");
        setLocking(false);
        setSaved("잠긴 파일로 내보냈어요. 파일 암호를 잊으면 아무도 열 수 없어요.");
      }
    } catch (err) {
      console.error("locked export failed", err);
      setError("파일을 만들지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4">
      <h2 className="title-2">일기 {entries.length.toLocaleString("ko-KR")}개 내보내기</h2>
      {disabled && disabledReason && <p className="muted text-sm">{disabledReason}</p>}

      <div className="space-y-3">
        <p className="note-warn">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          <span>
            Markdown과 JSON 파일은 잠겨 있지 않아요. 파일을 가진 사람은 누구나 읽을 수 있으니 안전한 곳에 두세요.
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void download("markdown")} disabled={disabled} className="btn-secondary">
            <Icon name="download" size={18} />
            Markdown (.md)
          </button>
          <button type="button" onClick={() => void download("json")} disabled={disabled} className="btn-secondary">
            <Icon name="download" size={18} />
            JSON (.json)
          </button>
        </div>
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 font-semibold">
            <Icon name="lock" size={18} />
            잠긴 파일로 내보내기
          </p>
          <p className="muted text-sm">
            파일 암호가 있어야 열리는 파일로 받아요. 이 파일은 불러오기로 어느 일기장에든 다시 가져올 수 있어요.
          </p>
        </div>
        {locking ? (
          <form onSubmit={(event) => void downloadLocked(event)} className="space-y-3">
            <div className="space-y-2">
              <PasswordField label="파일 암호" autoComplete="passphrase" autoFocus value={password} onChange={setPassword} />
              <PassphraseStrengthMeter passphrase={password} />
            </div>
            <PasswordField label="파일 암호 확인" autoComplete="passphrase" value={confirm} onChange={setConfirm} />
            <p className="text-[0.8125rem] leading-relaxed text-ink-3">
              파일 암호는 어디에도 저장하지 않아요. 잊으면 PrivateDiary도 이 파일을 열 수 없어요.
            </p>
            <FormError>{error}</FormError>
            <PanelActions
              submitLabel="잠긴 파일 받기"
              busyLabel="잠그는 중…"
              busy={busy || !!disabled}
              onCancel={() => {
                setLocking(false);
                setPassword("");
                setConfirm("");
                setError(null);
              }}
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setSaved(null);
              setLocking(true);
            }}
            disabled={disabled}
            className="btn-secondary"
          >
            <Icon name="lock" size={18} />
            잠긴 파일 받기
          </button>
        )}
      </div>

      {saved && (
        <p role="status" className="success-text flex gap-2">
          <Icon name="check-circle" size={18} className="mt-0.5 shrink-0" />
          {saved}
        </p>
      )}
      {!locking && <FormError>{error}</FormError>}
      <button type="button" onClick={onClose} className="btn-text">
        닫기
      </button>
    </div>
  );
}
