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
import { AuthShell, GoogleMark, OrDivider } from "@/components/AuthShell";
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
  usePageTitle(mode === "reset" ? "로그인 비밀번호 재설정" : "로그인");
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
      <AuthShell
        title="로그인 비밀번호 재설정"
        lead="가입한 이메일로 재설정 링크를 보내드려요."
        footer={
          <button type="button" onClick={() => switchMode("sign-in")} className="link">
            로그인으로 돌아가기
          </button>
        }
      >
        <div className="rounded-lg bg-zinc-100 p-3.5 text-sm leading-relaxed dark:bg-zinc-800">
          <p className="font-medium">일기 암호는 바뀌지 않아요</p>
          <p className="muted mt-1">
            로그인 비밀번호만 재설정됩니다. 일기 암호는 저희 서버에도 없어서 재설정해 드릴 수
            없어요. 일기 암호를 잊으셨다면, 로그인한 뒤 복구 코드로 새 암호를 정할 수 있습니다.
          </p>
        </div>
        {resetSent ? (
          <p role="status" className="success-text leading-relaxed">
            가입된 이메일이라면 재설정 링크를 보냈어요. 메일함(스팸함 포함)을 확인해주세요.
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
              {submitting ? "보내는 중..." : "재설정 메일 받기"}
            </button>
          </form>
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="다시 만나서 반가워요"
      lead="로그인한 뒤, 일기는 일기 암호로 한 번 더 열어요."
      footer={
        <>
          처음이신가요?{" "}
          <Link href="/signup" className="link font-medium">
            무료로 시작하기
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <TextField
          label="이메일"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
        />
        <div>
          <PasswordField
            label="로그인 비밀번호"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
          />
          <button
            type="button"
            onClick={() => switchMode("reset")}
            className="link faint mt-2 text-xs"
          >
            로그인 비밀번호를 잊으셨나요?
          </button>
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? "로그인 중..." : "로그인"}
        </button>
      </form>

      <OrDivider />

      <button
        type="button"
        onClick={() => void handleGoogle()}
        disabled={submitting}
        className="btn-secondary w-full"
      >
        <GoogleMark />
        Google로 계속하기
      </button>
    </AuthShell>
  );
}
