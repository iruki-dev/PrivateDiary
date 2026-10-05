"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useOtp } from "@/contexts/OtpContext";
import { IncorrectOtpCodeError, OtpLockedOutError } from "@/lib/firebase/otp";
import { LoadingState } from "@/components/LoadingState";

/**
 * Renders `children` only once OTP (if enabled on this account) has been
 * verified for the session; otherwise shows a code-entry prompt. Mirrors
 * firestore.rules' otpSatisfied() — see contexts/OtpContext.tsx.
 *
 * `footer` renders below the code-entry prompt, ONLY while it's showing
 * (never alongside `children`) — for a caller-provided way out of this
 * gate that doesn't involve a TOTP code, e.g. app/entries/page.tsx's "이
 * 계정은 백업 코드가 있습니다" switch-to-backup-code hint.
 */
export function OtpGate({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const { loading, otpEnabled, otpVerified, verify } = useOtp();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  if (loading) {
    return <LoadingState />;
  }

  if (!otpEnabled || otpVerified) {
    return <>{children}</>;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setVerifying(true);
    try {
      await verify(code);
      setCode("");
    } catch (err) {
      setError(
        err instanceof IncorrectOtpCodeError
          ? "코드가 올바르지 않습니다."
          : err instanceof OtpLockedOutError
            ? "시도 횟수를 초과했습니다. 1분 뒤 다시 시도해주세요."
            : "확인하지 못했습니다. 다시 시도해주세요."
      );
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="w-full max-w-sm space-y-3">
      <form onSubmit={handleSubmit} className="card space-y-4">
        <div className="space-y-1">
          <h2 className="font-semibold">OTP 인증</h2>
          <p className="muted">계속하려면 인증 앱에 표시된 코드를 입력하세요.</p>
        </div>
        <div>
          <label htmlFor="otp-gate-code" className="field-label">
            6자리 코드
          </label>
          <input
            id="otp-gate-code"
            type="text"
            required
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6,8}"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className="field-code"
          />
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button type="submit" disabled={verifying} className="btn-primary w-full">
          {verifying ? "확인 중..." : "확인"}
        </button>
      </form>
      {footer}
    </div>
  );
}
