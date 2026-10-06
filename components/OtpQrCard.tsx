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
    <div className="space-y-3 card">
      <p className="text-[0.9375rem] font-semibold">인증 앱으로 QR 코드를 찍어 주세요</p>
      {qrDataUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- generated data: URL, not a static/remote asset next/image can optimize
        <img src={qrDataUrl} alt="2단계 인증 설정 QR 코드" className="mx-auto h-44 w-44" />
      )}
      <p className="faint text-[0.8125rem]">QR 코드를 찍을 수 없다면 아래 코드를 인증 앱에 직접 넣어 주세요.</p>
      <p className="break-all rounded-xl bg-fill px-3 py-2.5 font-mono text-[0.9375rem] tracking-[0.04em]">{secret}</p>
    </div>
  );
}
