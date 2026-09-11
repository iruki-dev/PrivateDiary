"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useOtp } from "@/contexts/OtpContext";
import { useSeed } from "@/contexts/SeedContext";
import { OtpGate } from "@/components/OtpGate";
import { LoadingScreen, LoadingState } from "@/components/LoadingState";
import { usePageTitle } from "@/hooks/usePageTitle";
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
    lock,
    decryptionMethods,
  } = useSeed();
  const { loading: otpLoading, otpEnabled, otpVerified } = useOtp();
  const router = useRouter();
  usePageTitle("지난 일기");
  const canReadEntries = !otpLoading && (!otpEnabled || otpVerified);

  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const [metadata, setMetadata] = useState<StoredEntry[]>([]);

  const [decrypted, setDecrypted] = useState<Record<string, string>>({});
  const [decryptErrors, setDecryptErrors] = useState<Record<string, string>>({});
  // Which `metadata` array (by reference) decryption has finished for, so
  // "decrypting" below can be derived during render instead of tracked as
  // its own state set synchronously inside an effect.
  const [decryptedForMetadata, setDecryptedForMetadata] = useState<StoredEntry[] | null>(null);
  const decrypting = !!privateKeys && metadata.length > 0 && decryptedForMetadata !== metadata;

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

  // Re-lock (wipe the derived private keys from memory) whenever this page
  // is left — navigating to /write or /settings and back must require the
  // passphrase (or Shamir shares) again, not silently stay unlocked.
  // seedStatus/privateKeys live in SeedContext, which wraps the whole app
  // and therefore survives client-side navigation by default; without this,
  // once unlocked here, the diary stayed decrypted for the rest of the
  // browser tab's lifetime regardless of which page was showing.
  useEffect(() => {
    return () => lock();
  }, [lock]);

  useEffect(() => {
    // firestore.rules denies `entries` reads until OTP (if enabled on this
    // account) is verified — wait for that instead of letting the query
    // fail with permission-denied.
    if (!user || !canReadEntries) return;
    let cancelled = false;
    listEntries(user.uid)
      .then((entries) => {
        if (cancelled) return;
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
    // Depending on `metadata` (not just `privateKeys`) matters when this
    // page remounts while already unlocked — e.g. navigating away and back
    // via NavBar. `privateKeys` is unchanged (it lives in SeedContext, not
    // local state), so it alone wouldn't re-trigger this effect; the async
    // metadata fetch above resolving AFTER this effect's first run on mount
    // would otherwise leave every entry permanently undecrypted (rendering
    // as blank boxes) until a full page reload reset everything.
    if (!privateKeys || metadata.length === 0 || decryptedForMetadata === metadata) return;
    let cancelled = false;
    (async () => {
      const plaintexts: Record<string, string> = {};
      const errors: Record<string, string> = {};
      for (const entry of metadata) {
        try {
          plaintexts[entry.id] = await decryptEntry(privateKeys, entry.payload);
        } catch {
          errors[entry.id] = "복호화 실패 — 암호문이 변조되었을 수 있습니다.";
        }
      }
      if (!cancelled) {
        setDecrypted(plaintexts);
        setDecryptErrors(errors);
        setDecryptedForMetadata(metadata);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [privateKeys, metadata, decryptedForMetadata]);

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
    return <LoadingScreen />;
  }

  const otherModes: { mode: UnlockMode; label: string }[] = [
    { mode: "passphrase" as const, label: "패스프레이즈로 잠금 해제" },
    ...(decryptionMethods?.shamir
      ? [{ mode: "shamir" as const, label: "Shamir 조각으로 잠금 해제" }]
      : []),
  ].filter((m) => m.mode !== unlockMode);

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-10 sm:px-6 sm:py-16">
      <div className="w-full max-w-xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">지난 일기</h1>
          <Link href="/write" className="text-sm link">
            오늘의 일기 쓰기
          </Link>
        </div>

        <OtpGate>
          {!metadataLoaded && <LoadingState label="불러오는 중..." />}

          {metadataLoaded && metadata.length === 0 && (
            <div className="card space-y-3 text-center">
              <p className="muted">아직 작성한 일기가 없습니다.</p>
              <Link href="/write" className="btn-primary">
                첫 일기 쓰기
              </Link>
            </div>
          )}

          {metadataLoaded && metadata.length > 0 && seedStatus !== "unlocked" && (
            <form onSubmit={handleUnlock} className="space-y-3 card">
              {unlockMode === "passphrase" && (
                <>
                  <p className="muted">
                    총 {metadata.length}개의 일기가 있습니다. 내용을 보려면 패스프레이즈를
                    입력하세요.
                  </p>
                  <input
                    type="password"
                    required
                    autoFocus
                    autoComplete="current-password"
                    aria-label="패스프레이즈"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="패스프레이즈"
                    className="field"
                  />
                </>
              )}
              {unlockMode === "shamir" && decryptionMethods?.shamir && (
                <>
                  <p className="muted">{decryptionMethods.shamir.k}개의 조각을 입력하세요.</p>
                  {shareInputs.map((value, i) => (
                    <input
                      key={i}
                      type="text"
                      required
                      aria-label={`Shamir 조각 ${i + 1}`}
                      value={value}
                      onChange={(e) =>
                        setShareInputs((prev) =>
                          prev.map((v, idx) => (idx === i ? e.target.value : v))
                        )
                      }
                      placeholder={`조각 ${i + 1}`}
                      className="field-mono"
                    />
                  ))}
                </>
              )}
              {unlockError && (
                <p role="alert" className="error-text">
                  {unlockError}
                </p>
              )}
              <button type="submit" disabled={unlocking} className="btn-primary w-full">
                {unlocking ? "확인 중..." : "잠금 해제"}
              </button>
              {otherModes.map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => switchMode(mode)}
                  className="w-full text-center text-xs link"
                >
                  {label}
                </button>
              ))}
            </form>
          )}

          {seedStatus === "unlocked" && decrypting && <LoadingState label="복호화하는 중..." />}

          {seedStatus === "unlocked" && !decrypting && (
            <ul className="space-y-4">
              {metadata.map((entry) => (
                <li key={entry.id} className="card">
                  <p className="text-xs text-zinc-400">
                    {entry.createdAt?.toDate?.().toLocaleString("ko-KR") ?? "저장 중..."}
                  </p>
                  {decryptErrors[entry.id] ? (
                    <p className="mt-2 error-text">{decryptErrors[entry.id]}</p>
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
