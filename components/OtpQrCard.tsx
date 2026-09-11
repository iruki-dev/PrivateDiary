"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Displays an OTP setup QR code (encodes the otpauth:// URI, which is what
 * authenticator apps expect to scan) alongside the plain base32 secret for
 * manual entry. Purely presentational, like SecretCard, but distinct from
 * it: the QR here encodes a different string (the URI) than the text shown
 * below it (the bare secret), whereas SecretCard shows the same value in
 * both places.
 */
export function OtpQrCard({ uri, secret }: { uri: string; secret: string }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(uri, { margin: 1, width: 220 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return (
    <div className="space-y-3 rounded border border-zinc-300 p-4 dark:border-zinc-700">
      <p className="text-sm font-medium">인증 앱으로 QR 스캔</p>
      {qrDataUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- generated data: URL, not a static/remote asset next/image can optimize
        <img src={qrDataUrl} alt="OTP 설정 QR 코드" className="mx-auto h-44 w-44" />
      )}
      <p className="text-xs text-zinc-500">QR을 스캔할 수 없다면 아래 코드를 수동으로 입력하세요.</p>
      <p className="break-all rounded bg-zinc-100 p-2 font-mono text-xs dark:bg-zinc-800">{secret}</p>
    </div>
  );
}
