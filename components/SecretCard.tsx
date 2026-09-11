"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

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
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard access can fail (permissions, insecure context, etc.) —
      // the text is still selectable/visible below, so this is a soft
      // failure, not worth surfacing as an error.
    }
  }

  return (
    <div className="space-y-3 card">
      <p className="text-sm font-medium">{label}</p>
      {qrDataUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- generated data: URL, not a static/remote asset next/image can optimize
        <img src={qrDataUrl} alt={`${label} QR 코드`} className="mx-auto h-44 w-44" />
      )}
      <p className="break-all rounded bg-zinc-100 p-2 font-mono text-xs dark:bg-zinc-800">{text}</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => void handleCopy()} className="btn-secondary btn-sm flex-1">
          {copied ? "복사됨" : "복사"}
        </button>
        <button type="button" onClick={handleDownload} className="btn-secondary btn-sm flex-1">
          파일로 다운로드
        </button>
      </div>
    </div>
  );
}
