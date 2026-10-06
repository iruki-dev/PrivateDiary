"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { copyWithAutoClear } from "@/lib/security/clipboard";
import { saveTextFile } from "@/lib/saveFile";

/**
 * Displays one recovery secret (a recovery key, or a single Shamir share)
 * as scannable QR + copyable text + a downloadable .txt file. Purely
 * presentational — the caller decides what text to show and never persists
 * it anywhere itself.
 */
export function SecretCard({
  label,
  text,
  filename,
}: {
  label: string;
  text: string;
  filename: string;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(text, { margin: 1, width: 220 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [text]);

  // Resets the "복사됨" confirmation a couple seconds after copying, rather
  // than leaving it stuck until the next interaction.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  function handleDownload() {
    void saveTextFile(filename, "text/plain", text).catch(() => {});
  }

  async function handleCopy() {
    try {
      // lib/security/clipboard.ts: clears the clipboard again after a
      // delay (if it still holds exactly what was copied) — a recovery
      // key or Shamir share sitting in the clipboard indefinitely is
      // readable by any extension with clipboard-read permission, or any
      // other app on the device polling it.
      await copyWithAutoClear(text);
      setCopied(true);
    } catch {
      // Clipboard access can fail (permissions, insecure context, etc.) —
      // the text is still selectable/visible below, so this is a soft
      // failure, not worth surfacing as an error.
    }
  }

  return (
    <div className="card space-y-3">
      <p className="text-sm font-semibold text-ink-3">{label}</p>
      {qrDataUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- generated data: URL, not a static/remote asset next/image can optimize
        <img src={qrDataUrl} alt={`${label} QR 코드`} className="mx-auto h-44 w-44" />
      )}
      <p className="break-all rounded-xl bg-fill px-3 py-2.5 font-mono text-[0.9375rem] tracking-[0.04em]">{text}</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => void handleCopy()} className="btn-secondary min-h-11 flex-1">
          {copied ? "복사했어요" : "복사"}
        </button>
        <button type="button" onClick={handleDownload} className="btn-secondary min-h-11 flex-1">
          파일로 저장
        </button>
      </div>
      {copied && (
        <p className="faint text-[0.8125rem]">
          복사한 코드는 30초 뒤에 클립보드에서 지워져요.
        </p>
      )}
    </div>
  );
}
