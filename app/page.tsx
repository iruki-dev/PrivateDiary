"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/navigation";

export default function Home() {
  const { status: authStatus } = useAuth();
  const router = useRouter();
  usePageTitle("홈");

  useEffect(() => {
    if (authStatus === "signed-in") {
      router.replace(DEFAULT_SIGNED_IN_PATH);
    }
  }, [authStatus, router]);

  return (
    <main className="page-center flex-col gap-6 text-center">
      <h1 className="text-2xl font-semibold sm:text-3xl">PrivateDiary</h1>
      <div className="flex flex-col items-center gap-3">
        <p className="muted max-w-xs">누구도 아닌 나만 읽을 수 있는, 제로 지식 암호화 일기.</p>
        <Link href="/login" className="btn-primary">
          로그인
        </Link>
        <Link href="/signup" className="text-sm link">
          계정이 없으신가요? 회원가입
        </Link>
      </div>
    </main>
  );
}
