"use client";

import { useState } from "react";
import { buildExportFile, type ExportFormat, type ExportableEntry } from "@/lib/entries/export";
import { saveTextFile } from "@/lib/saveFile";
import { Icon } from "@/components/Icon";

/**
 * "Download my diary", available once the session is unlocked.
 *
 * This is the counterweight to ARCHITECTURE.md §3.6 rule 5 / §9: an app
 * that will genuinely and permanently destroy your writing if you forget
 * one passphrase owes you a copy you can keep yourself. Without it,
 * "zero-knowledge" quietly also means "no way out".
 *
 * The file is plaintext by construction — that's the point of an archive
 * that outlives this app and its keys — so the warning is stated up front
 * rather than buried, and the download takes a second, deliberate click.
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

  async function download(format: ExportFormat) {
    setError(null);
    try {
      const file = buildExportFile(entries, format);
      await saveTextFile(file.filename, file.mimeType, file.content);
    } catch (err) {
      console.error("export failed", err);
      setError("파일을 만들지 못했어요. 다시 시도해 주세요.");
    }
  }

  return (
    <div className="card space-y-4">
      <h2 className="title-2">일기 {entries.length.toLocaleString("ko-KR")}개 내보내기</h2>
      <p className="note-warn">
        <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
        <span>
          받은 파일은 잠겨 있지 않아요. 파일을 가진 사람은 누구나 읽을 수 있으니 안전한 곳에 두세요.
        </span>
      </p>
      {disabled && disabledReason && <p className="muted text-sm">{disabledReason}</p>}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void download("markdown")}
          disabled={disabled}
          className="btn-secondary"
        >
          <Icon name="download" size={18} />
          Markdown (.md)
        </button>
        <button
          type="button"
          onClick={() => void download("json")}
          disabled={disabled}
          className="btn-secondary"
        >
          <Icon name="download" size={18} />
          JSON (.json)
        </button>
        <button type="button" onClick={onClose} className="btn-text">
          닫기
        </button>
      </div>
    </div>
  );
}
