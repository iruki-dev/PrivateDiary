"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useSeed } from "@/contexts/SeedContext";
import { writeEntry } from "@/lib/firebase/entries";

/**
 * Phase 5 write path (ARCHITECTURE.md §3.2 rule 5): works from any
 * logged-in device using only the recipient's public keys. Deliberately
 * does NOT gate on seedStatus === "unlocked" — publicKeys are available as
 * soon as key issuance is done ("locked" is enough), matching the
 * architecture's "쓰기는 시드/개인키 없이 가능" requirement.
 */
export default function WritePage() {
  const { user, status: authStatus } = useAuth();
  const { status: seedStatus, publicKeys } = useSeed();
  const router = useRouter();

  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (authStatus === "signed-in" && seedStatus === "not-issued") {
      router.replace("/signup");
    }
  }, [authStatus, seedStatus, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !publicKeys) return;
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      await writeEntry(user.uid, publicKeys, text);
      setText("");
      setSuccess(true);
    } catch {
      setError("저장하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  if (authStatus !== "signed-in" || !publicKeys) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">확인 중...</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <form onSubmit={handleSubmit} className="w-full max-w-xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">오늘의 일기</h1>
          <Link href="/entries" className="text-sm underline">
            지난 일기 보기
          </Link>
        </div>
        <textarea
          required
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder="오늘 하루는 어땠나요?"
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">저장되었습니다.</p>}
        <button
          type="submit"
          disabled={submitting || !text.trim()}
          className="rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {submitting ? "저장 중..." : "저장"}
        </button>
      </form>
    </main>
  );
}
