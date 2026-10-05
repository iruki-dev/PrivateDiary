"use client";

import { useState } from "react";
import { buildExportFile, type ExportFormat, type ExportableEntry } from "@/lib/entries/export";

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

  function download(format: ExportFormat) {
    setError(null);
    try {
      const file = buildExportFile(entries, format);
      const blob = new Blob([file.content], { type: file.mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      // Revoking immediately can cancel the download in some browsers, so
      // this waits a turn — the object URL is scoped to this document and
      // goes away with the tab regardless.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error("export failed", err);
      setError("내보내기에 실패했습니다. 다시 시도해주세요.");
    }
  }

  return (
    <div className="card space-y-3">
      <h2 className="text-sm font-semibold">일기 {entries.length}편 내보내기</h2>
      <p className="muted text-xs leading-relaxed">
        받은 파일은 <strong className="text-foreground">암호화되지 않은 일반 텍스트</strong>입니다. 파일을
        가진 사람은 누구나 읽을 수 있으니 안전한 곳에 보관하세요.
      </p>
      {disabled && disabledReason && <p className="muted text-xs">{disabledReason}</p>}
      {error && (
        <p role="alert" className="error-text text-xs">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => download("markdown")}
          disabled={disabled}
          className="btn-secondary btn-sm"
        >
          Markdown (.md)
        </button>
        <button
          type="button"
          onClick={() => download("json")}
          disabled={disabled}
          className="btn-secondary btn-sm"
        >
          JSON (.json)
        </button>
        <button type="button" onClick={onClose} className="btn-secondary btn-sm">
          닫기
        </button>
      </div>
    </div>
  );
}
