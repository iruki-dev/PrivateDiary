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
      <h2 className="text-sm font-semibold">일기 내보내기</h2>
      <p className="muted text-xs">
        일기 {entries.length}개를 파일로 내려받습니다. 암호를 잊고 백업 코드까지 잃어버리면 일기는
        영구히 복구할 수 없으므로, 별도의 사본을 직접 보관해두는 것을 권장합니다.
      </p>
      <p className="error-text text-xs">
        내려받는 파일은 <strong>암호화되어 있지 않습니다.</strong> 파일을 열 수 있는 사람은 누구나
        내용을 그대로 읽을 수 있으니, 암호화된 저장소나 오프라인 매체에 보관하세요.
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
