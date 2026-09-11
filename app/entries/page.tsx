"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useSeed } from "@/contexts/SeedContext";
import { listEntries, type StoredEntry } from "@/lib/firebase/entries";
import { decryptEntry, WrongPassphraseError } from "@/lib/crypto";

/**
 * Phase 5 read path. Entry dates/count are always visible (they're not
 * secret — only the content is), but plaintext is only ever computed after
 * the seed is unlocked in this session (ARCHITECTURE.md §3.3, Phase 5:
 * "미입력 상태에서는 암호문 존재 여부만 노출하고 본문은 절대 노출하지 않음").
 */
export default function EntriesPage() {
  const { user, status: authStatus } = useAuth();
  const { status: seedStatus, privateKeys, unlock } = useSeed();
  const router = useRouter();

  const entriesRef = useRef<StoredEntry[]>([]);
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const [metadata, setMetadata] = useState<StoredEntry[]>([]);

  const [decrypted, setDecrypted] = useState<Record<string, string>>({});
  const [decryptErrors, setDecryptErrors] = useState<Record<string, string>>({});
  const [decrypting, setDecrypting] = useState(false);

  const [passphrase, setPassphrase] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    if (authStatus === "signed-in" && seedStatus === "not-issued") {
      router.replace("/signup");
    }
  }, [authStatus, seedStatus, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listEntries(user.uid).then((entries) => {
      if (cancelled) return;
      entriesRef.current = entries;
      setMetadata(entries);
      setMetadataLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!privateKeys || entriesRef.current.length === 0) return;
    let cancelled = false;
    setDecrypting(true);
    (async () => {
      const plaintexts: Record<string, string> = {};
      const errors: Record<string, string> = {};
      for (const entry of entriesRef.current) {
        try {
          plaintexts[entry.id] = await decryptEntry(privateKeys, entry.payload);
        } catch {
          errors[entry.id] = "복호화 실패 — 암호문이 변조되었을 수 있습니다.";
        }
      }
      if (!cancelled) {
        setDecrypted(plaintexts);
        setDecryptErrors(errors);
        setDecrypting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [privateKeys]);

  async function handleUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUnlockError(null);
    setUnlocking(true);
    try {
      await unlock(passphrase);
      setPassphrase("");
    } catch (err) {
      setUnlockError(
        err instanceof WrongPassphraseError
          ? "패스프레이즈가 올바르지 않습니다."
          : "잠금 해제에 실패했습니다."
      );
    } finally {
      setUnlocking(false);
    }
  }

  if (authStatus !== "signed-in") {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">확인 중...</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">지난 일기</h1>
          <Link href="/write" className="text-sm underline">
            오늘의 일기 쓰기
          </Link>
        </div>

        {!metadataLoaded && <p className="text-sm text-zinc-600 dark:text-zinc-400">불러오는 중...</p>}

        {metadataLoaded && metadata.length === 0 && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">아직 작성한 일기가 없습니다.</p>
        )}

        {metadataLoaded && metadata.length > 0 && seedStatus !== "unlocked" && (
          <form
            onSubmit={handleUnlock}
            className="space-y-3 rounded border border-zinc-300 p-4 dark:border-zinc-700"
          >
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              총 {metadata.length}개의 일기가 있습니다. 내용을 보려면 패스프레이즈를 입력하세요.
            </p>
            <input
              type="password"
              required
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="패스프레이즈"
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            {unlockError && <p className="text-sm text-red-600">{unlockError}</p>}
            <button
              type="submit"
              disabled={unlocking}
              className="w-full rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
            >
              {unlocking ? "확인 중..." : "잠금 해제"}
            </button>
          </form>
        )}

        {seedStatus === "unlocked" && decrypting && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">복호화하는 중...</p>
        )}

        {seedStatus === "unlocked" && !decrypting && (
          <ul className="space-y-4">
            {metadata.map((entry) => (
              <li key={entry.id} className="rounded border border-zinc-300 p-4 dark:border-zinc-700">
                <p className="text-xs text-zinc-400">
                  {entry.createdAt?.toDate?.().toLocaleString("ko-KR") ?? "저장 중..."}
                </p>
                {decryptErrors[entry.id] ? (
                  <p className="mt-2 text-sm text-red-600">{decryptErrors[entry.id]}</p>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap text-sm">{decrypted[entry.id]}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
