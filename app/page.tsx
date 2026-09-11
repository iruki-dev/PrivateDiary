"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useSeed } from "@/contexts/SeedContext";
import { signOut } from "@/lib/firebase/auth";

export default function Home() {
  const { user, status: authStatus } = useAuth();
  const { status: seedStatus } = useSeed();
  const router = useRouter();

  useEffect(() => {
    if (authStatus === "signed-in" && seedStatus === "not-issued") {
      router.replace("/signup");
    }
  }, [authStatus, seedStatus, router]);

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

      {authStatus === "signed-in" && seedStatus !== "not-issued" && (
        <div className="space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
          <p>{user?.email}로 로그인됨</p>
          <p>
            시드 상태:{" "}
            {
              {
                unknown: "확인 중...",
                "not-issued": "미발급",
                locked: "잠김",
                unlocked: "잠금 해제됨",
              }[seedStatus]
            }
          </p>
          <div className="flex justify-center gap-4">
            <Link href="/settings" className="underline">
              설정
            </Link>
            <button onClick={() => signOut()} className="underline">
              로그아웃
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
