"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
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
import { Icon } from "@/components/Icon";
import { PasswordField, TextField } from "@/components/PasswordField";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useGoogleSignInAvailable } from "@/hooks/useGoogleSignInAvailable";
import { LoadingScreen } from "@/components/LoadingState";
import { safeNextPath } from "@/lib/navigation";

type Mode = "sign-in" | "reset";

/**
 * useSearchParams() needs a Suspense boundary for the page to be
 * prerendered as a static file (the Android build, next.config.ts).
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const { status } = useAuth();
  const router = useRouter();
  // Where the visitor was headed before useAccountGate sent them here.
  const next = safeNextPath(useSearchParams().get("next"));
  const [mode, setMode] = useState<Mode>("sign-in");
  const googleAvailable = useGoogleSignInAvailable();
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
      <AuthShell title="로그인 비밀번호 재설정" lead="가입한 이메일로 재설정 링크를 보내 드려요.">
        <p className="rounded-2xl bg-fill px-4 py-3 text-sm leading-relaxed text-ink-2">
          로그인 비밀번호만 바꿀 수 있어요. 일기 암호는 어디에도 저장하지 않아서 재설정할 수 없어요. 일기
          암호를 잊었다면 로그인한 뒤 백업 코드로 새 암호를 정해 주세요.
        </p>
        {resetSent ? (
          <p role="status" className="flex gap-2 text-[0.9375rem] text-ink">
            <Icon name="check-circle" size={20} className="mt-px shrink-0" />
            가입한 이메일이라면 재설정 링크를 보냈어요. 메일함을 확인해 주세요.
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
              placeholder="name@example.com"
            />
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <button type="submit" disabled={submitting} className="btn-primary min-h-14 w-full rounded-2xl text-[1.0625rem]">
              {submitting ? "보내는 중…" : "재설정 링크 받기"}
            </button>
          </form>
        )}
        <button type="button" onClick={() => switchMode("sign-in")} className="btn-text w-full">
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
          placeholder="name@example.com"
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
        <button type="submit" disabled={submitting} className="btn-primary min-h-14 w-full rounded-2xl text-[1.0625rem]">
          {submitting ? "로그인하는 중…" : "로그인"}
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-center gap-x-2">
        <Link href="/signup" className="btn-text">
          계정 만들기
        </Link>
        <span aria-hidden className="h-3 w-px bg-line" />
        <button type="button" onClick={() => switchMode("reset")} className="btn-text">
          비밀번호를 잊었어요
        </button>
      </div>

      {googleAvailable && (
        <>
          <OrDivider />
          <button
            type="button"
            onClick={() => void handleGoogle()}
            disabled={submitting}
            className="btn-secondary w-full"
          >
            Google로 계속하기
          </button>
        </>
      )}
    </AuthShell>
  );
}
