"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useSeed, type SeedStatus } from "@/contexts/SeedContext";
import { LoadingState } from "@/components/LoadingState";
import { usePageTitle } from "@/hooks/usePageTitle";

const SEED_STATUS_LABEL: Record<SeedStatus, string> = {
  unknown: "확인 중...",
  "not-issued": "미발급",
  locked: "잠김",
  unlocked: "잠금 해제됨",
};

export default function Home() {
  const { user, status: authStatus } = useAuth();
  const { status: seedStatus } = useSeed();
  const router = useRouter();
  usePageTitle("홈");

  useEffect(() => {
    if (authStatus === "signed-in" && seedStatus === "not-issued") {
      router.replace("/signup");
    }
  }, [authStatus, seedStatus, router]);

  return (
    <main className="page-center flex-col gap-6 text-center">
      <h1 className="text-2xl font-semibold sm:text-3xl">PrivateDiary</h1>

      {authStatus === "loading" && <LoadingState label="로그인 상태 확인 중..." />}

      {authStatus === "signed-out" && (
        <div className="flex flex-col items-center gap-3">
          <p className="muted max-w-xs">누구도 아닌 나만 읽을 수 있는, 제로 지식 암호화 일기.</p>
          <Link href="/login" className="btn-primary">
            로그인
          </Link>
          <Link href="/signup" className="text-sm link">
            계정이 없으신가요? 회원가입
          </Link>
        </div>
      )}

      {authStatus === "signed-in" && seedStatus !== "not-issued" && (
        <div className="flex flex-col items-center gap-4">
          <div className="muted space-y-1">
            <p>{user?.email}로 로그인됨</p>
            <p>시드 상태: {SEED_STATUS_LABEL[seedStatus]}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/write" className="btn-primary">
              오늘의 일기 쓰기
            </Link>
            <Link href="/entries" className="btn-secondary">
              지난 일기 보기
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
