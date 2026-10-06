"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useOtp } from "@/contexts/OtpContext";
import { IncorrectOtpCodeError, OtpLockedOutError } from "@/lib/firebase/otp";
import { LoadingState } from "@/components/LoadingState";
import { Icon } from "@/components/Icon";

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
          ? "인증 앱의 숫자를 다시 확인해 주세요."
          : err instanceof OtpLockedOutError
            ? "여러 번 틀려서 잠시 막아 두었어요. 1분 뒤에 다시 시도해 주세요."
            : "확인하지 못했어요. 다시 시도해 주세요."
      );
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="w-full space-y-2">
      <form onSubmit={handleSubmit} className="card space-y-5">
        <div className="flex gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary">
            <Icon name="shield" size={22} />
          </span>
          <div className="space-y-0.5">
            <h2 className="text-[1.0625rem] font-bold">2단계 인증</h2>
            <p className="muted text-sm">인증 앱에 보이는 숫자를 넣어 주세요.</p>
          </div>
        </div>
        <div>
          <label htmlFor="otp-gate-code" className="field-label">
            6자리 숫자
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
            placeholder="000000"
            className="field-code"
          />
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button type="submit" disabled={verifying} className="btn-primary min-h-14 w-full rounded-2xl text-[1.0625rem]">
          {verifying ? "확인하는 중…" : "확인"}
        </button>
      </form>
      {footer}
    </div>
  );
}
