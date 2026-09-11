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

  function handleDownload() {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3 rounded border border-zinc-300 p-4 dark:border-zinc-700">
      <p className="text-sm font-medium">{label}</p>
      {qrDataUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- generated data: URL, not a static/remote asset next/image can optimize
        <img src={qrDataUrl} alt={`${label} QR 코드`} className="mx-auto h-44 w-44" />
      )}
      <p className="break-all rounded bg-zinc-100 p-2 font-mono text-xs dark:bg-zinc-800">{text}</p>
      <button
        type="button"
        onClick={handleDownload}
        className="w-full rounded border border-zinc-300 px-3 py-1.5 text-xs font-medium dark:border-zinc-700"
      >
        텍스트 파일로 다운로드
      </button>
    </div>
  );
}
