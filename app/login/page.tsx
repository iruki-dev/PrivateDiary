"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { sendLoginPasswordReset, signInWithEmail, signInWithGoogle } from "@/lib/firebase/auth";
import {
  authErrorCode,
  isUserCancelledPopup,
  passwordResetErrorMessage,
  signInErrorMessage,
} from "@/lib/firebase/authErrors";
import { AuthShell, OrDivider } from "@/components/AuthShell";
import { PasswordField, TextField } from "@/components/PasswordField";
import { usePageTitle } from "@/hooks/usePageTitle";
import { safeNextPath } from "@/lib/navigation";

type Mode = "sign-in" | "reset";

export default function LoginPage() {
  const { status } = useAuth();
  const router = useRouter();
  // Where the visitor was headed before useAccountGate sent them here.
  const next = safeNextPath(useSearchParams().get("next"));
  const [mode, setMode] = useState<Mode>("sign-in");
  usePageTitle(mode === "reset" ? "비밀번호 재설정" : "로그인");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "signed-in") {
      router.replace(next);
    }
  }, [status, router, next]);

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setError(null);
    setResetSent(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInWithEmail(email, password);
      router.replace(next);
    } catch (err) {
      setError(signInErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
      router.replace(next);
    } catch (err) {
      if (!isUserCancelledPopup(err)) {
        console.error("signInWithGoogle failed", err);
        setError(signInErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await sendLoginPasswordReset(email);
      setResetSent(true);
    } catch (err) {
      // Projects without email enumeration protection (and the local Auth
      // emulator) reject unknown addresses. Answer exactly as for a known
      // one, so this form never reveals who has an account.
      if (authErrorCode(err) === "auth/user-not-found") {
        setResetSent(true);
        return;
      }
      setError(passwordResetErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (mode === "reset") {
    return (
      <AuthShell title="비밀번호 재설정" lead="가입한 이메일로 로그인 비밀번호 재설정 링크를 보내드립니다.">
        <p className="muted card">
          로그인 비밀번호만 재설정됩니다. 일기 암호는 서버에 저장되지 않으므로 재설정할 수
          없습니다. 일기 암호를 잊었다면 로그인한 뒤 백업 코드로 새 암호를 설정할 수 있습니다.
        </p>
        {resetSent ? (
          <p role="status" className="success-text">
            가입된 이메일이라면 재설정 링크가 발송되었습니다. 메일함을 확인해주세요.
          </p>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            <TextField
              label="이메일"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
            />
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting ? "발송 중..." : "재설정 링크 받기"}
            </button>
          </form>
        )}
        <button type="button" onClick={() => switchMode("sign-in")} className="block w-full text-center text-sm link">
          로그인으로 돌아가기
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="로그인">
      <form onSubmit={handleSubmit} className="space-y-4">
        <TextField
          label="이메일"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
        />
        <PasswordField
          label="로그인 비밀번호"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? "로그인 중..." : "로그인"}
        </button>
      </form>

      <div className="flex flex-col items-center gap-2 text-sm">
        <Link href="/signup" className="link">
          계정이 없으신가요? 회원가입
        </Link>
        <button type="button" onClick={() => switchMode("reset")} className="faint link text-xs">
          로그인 비밀번호를 잊으셨나요?
        </button>
      </div>

      <OrDivider />

      <button
        type="button"
        onClick={() => void handleGoogle()}
        disabled={submitting}
        className="btn-secondary w-full"
      >
        Google로 계속하기
      </button>
    </AuthShell>
  );
}
