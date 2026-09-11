"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useOtp } from "@/contexts/OtpContext";
import { useSeed } from "@/contexts/SeedContext";
import { OtpGate } from "@/components/OtpGate";
import { listEntries, type StoredEntry } from "@/lib/firebase/entries";
import {
  decryptEntry,
  textToRecoverySecret,
  InvalidShamirSharesError,
  WrongPassphraseError,
} from "@/lib/crypto";

type UnlockMode = "passphrase" | "shamir";

/**
 * Phase 5 read path. Entry dates/count are always visible (they're not
 * secret — only the content is), but plaintext is only ever computed after
 * the seed is unlocked in this session (ARCHITECTURE.md §3.3, Phase 5:
 * "미입력 상태에서는 암호문 존재 여부만 노출하고 본문은 절대 노출하지 않음").
 *
 * The passphrase and Shamir shares are co-equal master credentials
 * (ARCHITECTURE.md §3.7, contexts/SeedContext.tsx) — either reaches the
 * same "unlocked" state. Passphrase is the everyday default; Shamir is the
 * fallback if it's forgotten.
 */
export default function EntriesPage() {
  const { user, status: authStatus } = useAuth();
  const {
    status: seedStatus,
    privateKeys,
    unlock,
    unlockWithShamirShares,
    decryptionMethods,
  } = useSeed();
  const { loading: otpLoading, otpEnabled, otpVerified } = useOtp();
  const router = useRouter();
  const canReadEntries = !otpLoading && (!otpEnabled || otpVerified);

  const entriesRef = useRef<StoredEntry[]>([]);
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const [metadata, setMetadata] = useState<StoredEntry[]>([]);

  const [decrypted, setDecrypted] = useState<Record<string, string>>({});
  const [decryptErrors, setDecryptErrors] = useState<Record<string, string>>({});
  const [decrypting, setDecrypting] = useState(false);

  const [unlockMode, setUnlockMode] = useState<UnlockMode>("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [shareInputs, setShareInputs] = useState<string[]>([]);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    if (authStatus === "signed-in" && seedStatus === "not-issued") {
      router.replace("/signup");
    }
  }, [authStatus, seedStatus, router]);

  useEffect(() => {
    // firestore.rules denies `entries` reads until OTP (if enabled on this
    // account) is verified — wait for that instead of letting the query
    // fail with permission-denied.
    if (!user || !canReadEntries) return;
    let cancelled = false;
    listEntries(user.uid)
      .then((entries) => {
        if (cancelled) return;
        entriesRef.current = entries;
        setMetadata(entries);
        setMetadataLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setMetadataLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user, canReadEntries]);

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

  function switchMode(mode: UnlockMode) {
    setUnlockError(null);
    setUnlockMode(mode);
    if (mode === "shamir" && decryptionMethods?.shamir) {
      setShareInputs(Array(decryptionMethods.shamir.k).fill(""));
    }
  }

  async function handleUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUnlockError(null);
    setUnlocking(true);
    try {
      if (unlockMode === "passphrase") {
        await unlock(passphrase);
        setPassphrase("");
      } else {
        await unlockWithShamirShares(shareInputs.map((s) => textToRecoverySecret(s)));
        setShareInputs(decryptionMethods?.shamir ? Array(decryptionMethods.shamir.k).fill("") : []);
      }
    } catch (err) {
      setUnlockError(
        err instanceof WrongPassphraseError
          ? "패스프레이즈가 올바르지 않습니다."
          : err instanceof InvalidShamirSharesError
            ? "조각들이 올바른 시드로 복원되지 않습니다."
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

  const otherModes: { mode: UnlockMode; label: string }[] = [
    { mode: "passphrase" as const, label: "패스프레이즈로 잠금 해제" },
    ...(decryptionMethods?.shamir
      ? [{ mode: "shamir" as const, label: "Shamir 조각으로 잠금 해제" }]
      : []),
  ].filter((m) => m.mode !== unlockMode);

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">지난 일기</h1>
          <Link href="/write" className="text-sm underline">
            오늘의 일기 쓰기
          </Link>
        </div>

        <OtpGate>
          {!metadataLoaded && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">불러오는 중...</p>
          )}

          {metadataLoaded && metadata.length === 0 && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">아직 작성한 일기가 없습니다.</p>
          )}

          {metadataLoaded && metadata.length > 0 && seedStatus !== "unlocked" && (
            <form
              onSubmit={handleUnlock}
              className="space-y-3 rounded border border-zinc-300 p-4 dark:border-zinc-700"
            >
              {unlockMode === "passphrase" && (
                <>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    총 {metadata.length}개의 일기가 있습니다. 내용을 보려면 패스프레이즈를
                    입력하세요.
                  </p>
                  <input
                    type="password"
                    required
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="패스프레이즈"
                    className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </>
              )}
              {unlockMode === "shamir" && decryptionMethods?.shamir && (
                <>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {decryptionMethods.shamir.k}개의 조각을 입력하세요.
                  </p>
                  {shareInputs.map((value, i) => (
                    <input
                      key={i}
                      type="text"
                      required
                      value={value}
                      onChange={(e) =>
                        setShareInputs((prev) =>
                          prev.map((v, idx) => (idx === i ? e.target.value : v))
                        )
                      }
                      placeholder={`조각 ${i + 1}`}
                      className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  ))}
                </>
              )}
              {unlockError && <p className="text-sm text-red-600">{unlockError}</p>}
              <button
                type="submit"
                disabled={unlocking}
                className="w-full rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
              >
                {unlocking ? "확인 중..." : "잠금 해제"}
              </button>
              {otherModes.map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => switchMode(mode)}
                  className="w-full text-center text-xs underline"
                >
                  {label}
                </button>
              ))}
            </form>
          )}

          {seedStatus === "unlocked" && decrypting && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">복호화하는 중...</p>
          )}

          {seedStatus === "unlocked" && !decrypting && (
            <ul className="space-y-4">
              {metadata.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded border border-zinc-300 p-4 dark:border-zinc-700"
                >
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
        </OtpGate>
      </div>
    </main>
  );
}
