"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { signInWithEmail, signInWithGoogle } from "@/lib/firebase/auth";
import { usePageTitle } from "@/hooks/usePageTitle";

function friendlyAuthError(err: unknown): string {
  const code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "이메일 또는 비밀번호가 올바르지 않습니다.";
    default:
      return "로그인에 실패했습니다. 다시 시도해주세요.";
  }
}

export default function LoginPage() {
  const { status } = useAuth();
  const router = useRouter();
  usePageTitle("로그인");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "signed-in") {
      router.replace("/");
    }
  }, [status, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInWithEmail(email, password);
      router.replace("/");
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
      router.replace("/");
    } catch {
      setError("Google 로그인에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-center">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-xl font-semibold">로그인</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            required
            autoComplete="email"
            aria-label="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="field"
          />
          <input
            type="password"
            required
            autoComplete="current-password"
            aria-label="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            className="field"
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

        <Link href="/signup" className="block text-center text-sm link">
          계정이 없으신가요? 회원가입
        </Link>

        <div className="flex items-center gap-3 text-xs text-zinc-400">
          <div className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
          또는
          <div className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
        </div>

        <button
          type="button"
          onClick={() => void handleGoogle()}
          disabled={submitting}
          className="btn-secondary w-full"
        >
          Google로 계속하기
        </button>
      </div>
    </main>
  );
}
