"use client";

import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useSeed } from "@/contexts/SeedContext";
import { signOut } from "@/lib/firebase/auth";

export default function Home() {
  const { user, status: authStatus } = useAuth();
  const { status: seedStatus } = useSeed();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">PrivateDiary</h1>

      {authStatus === "loading" && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">로그인 상태 확인 중...</p>
      )}

      {authStatus === "signed-out" && (
        <Link
          href="/login"
          className="rounded bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          로그인
        </Link>
      )}

      {authStatus === "signed-in" && (
        <div className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
          <p>{user?.email}로 로그인됨</p>
          <p>
            시드 상태:{" "}
            {
              {
                unknown: "확인 중...",
                "not-issued": "미발급 (온보딩 필요 — Phase 4)",
                locked: "잠김",
                unlocked: "잠금 해제됨",
              }[seedStatus]
            }
          </p>
          <button onClick={() => signOut()} className="underline">
            로그아웃
          </button>
        </div>
      )}
    </main>
  );
}
