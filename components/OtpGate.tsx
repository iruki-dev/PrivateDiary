"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useOtp } from "@/contexts/OtpContext";
import { IncorrectOtpCodeError, OtpLockedOutError } from "@/lib/firebase/otp";

/**
 * Renders `children` only once OTP (if enabled on this account) has been
 * verified for the session; otherwise shows a code-entry prompt. Mirrors
 * firestore.rules' otpSatisfied() — see contexts/OtpContext.tsx.
 */
export function OtpGate({ children }: { children: ReactNode }) {
  const { loading, otpEnabled, otpVerified, verify } = useOtp();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  if (loading) {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">확인 중...</p>;
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
            ? "시도 횟수를 초과했습니다. 잠시 후 다시 시도하세요."
            : "인증에 실패했습니다."
      );
    } finally {
      setVerifying(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-sm space-y-3 rounded border border-zinc-300 p-4 dark:border-zinc-700"
    >
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        이 계정은 OTP 인증이 활성화되어 있습니다. 인증 앱의 코드를 입력하세요.
      </p>
      <input
        type="text"
        required
        inputMode="numeric"
        pattern="[0-9]{6,8}"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="123456"
        className="w-full rounded border border-zinc-300 px-3 py-2 text-center font-mono text-lg tracking-widest dark:border-zinc-700 dark:bg-zinc-900"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={verifying}
        className="w-full rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
      >
        {verifying ? "확인 중..." : "인증"}
      </button>
    </form>
  );
}
