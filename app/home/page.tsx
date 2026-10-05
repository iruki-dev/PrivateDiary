"use client";

import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { LoadingScreen } from "@/components/LoadingState";
import { useAccountGate } from "@/hooks/useAccountGate";
import { usePageTitle } from "@/hooks/usePageTitle";

/** Signed-in home. "/" is the public landing page; this is where an account lands. */
export default function HomePage() {
  const { user } = useAuth();
  const ready = useAccountGate();
  usePageTitle("홈");

  if (!ready) {
    return <LoadingScreen />;
  }

  return (
    <main className="page-center flex-col gap-6 text-center">
      <p className="muted">{user?.email}로 로그인됨</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/write" className="btn-primary">
          오늘의 일기 쓰기
        </Link>
        <Link href="/entries" className="btn-secondary">
          지난 일기 보기
        </Link>
      </div>
    </main>
  );
}
