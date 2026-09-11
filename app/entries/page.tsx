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
import { ShamirNotConfiguredError } from "@/lib/firebase/otp";
import {
  bytesToBase64,
  computeShamirOtpBypassProof,
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
 *
 * OTP (ARCHITECTURE.md §3.8), when enabled, gates the underlying
 * `entries` READ itself (via firestore.rules' otpSatisfied()) — not just
 * the UI. Since fetching ciphertext has to succeed before either
 * credential can be tried against it, an OTP-enabled account normally
 * can't reach EITHER unlock form until OTP is verified first. Shamir mode
 * is the one exception: it satisfies the same server-side gate via
 * verifyShamirOtpBypass instead of a TOTP code (structurally impossible
 * to do with just the passphrase — see lib/crypto/recovery.ts), so the
 * Shamir recovery path never depends on still having the OTP device
 * around. This is why entry-count-dependent copy ("총 N개의 일기가
 * 있습니다") only appears once metadata is actually reachable — in the
 * OTP-blocking-and-not-yet-bypassed state, nothing has been fetched yet.
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
  const { loading: otpLoading, otpEnabled, otpVerified, verifyViaShamirBypass } = useOtp();
  const router = useRouter();
  usePageTitle("지난 일기");
  const canReadEntries = !otpLoading && (!otpEnabled || otpVerified);
  const otpBlocking = !otpLoading && otpEnabled && !otpVerified;

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
  // Separate from unlockError: once unlockWithShamirShares below succeeds,
  // seedStatus flips to "unlocked" and the unlock form (and its error slot)
  // unmounts on the very next render — before a subsequent OTP-bypass
  // failure would ever get a chance to show through it. This is shown
  // instead, in the "unlocked but still can't read" branch further down.
  const [otpBypassError, setOtpBypassError] = useState<string | null>(null);

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
    setOtpBypassError(null);
    setUnlocking(true);
    try {
      if (unlockMode === "passphrase") {
        await unlock(passphrase);
        setPassphrase("");
      } else {
        const shares = shareInputs.map((s) => textToRecoverySecret(s));
        await unlockWithShamirShares(shares);
        setShareInputs(decryptionMethods?.shamir ? Array(decryptionMethods.shamir.k).fill("") : []);
        if (otpBlocking) {
          try {
            const proof = await computeShamirOtpBypassProof(shares);
            await verifyViaShamirBypass(bytesToBase64(proof));
          } catch (err) {
            setOtpBypassError(
              err instanceof ShamirNotConfiguredError
                ? "백업 코드가 설정되어 있지 않아 OTP를 건너뛸 수 없습니다."
                : "OTP 우회 인증에 실패했습니다. 아래 OTP 코드를 입력하거나 새로고침 후 다시 시도하세요."
            );
          }
        }
      }
    } catch (err) {
      setUnlockError(
        err instanceof WrongPassphraseError
          ? "암호가 올바르지 않습니다."
          : err instanceof InvalidShamirSharesError
            ? "백업 코드가 올바른 시드로 복원되지 않습니다."
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
    { mode: "passphrase" as const, label: "암호로 잠금 해제" },
    ...(decryptionMethods?.shamir
      ? [{ mode: "shamir" as const, label: "백업 코드로 잠금 해제" }]
      : []),
  ].filter((m) => m.mode !== unlockMode);

  const shamirFields = (
    <>
      {shareInputs.map((value, i) => (
        <input
          key={i}
          type="text"
          required
          aria-label={`백업 코드 ${i + 1}`}
          value={value}
          onChange={(e) =>
            setShareInputs((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
          }
          placeholder={`코드 ${i + 1}`}
          className="field-mono"
        />
      ))}
    </>
  );

  const modeSwitcherLinks = (
    <>
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
    </>
  );

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-10 sm:px-6 sm:py-16">
      <div className="w-full max-w-xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">지난 일기</h1>
          <Link href="/write" className="text-sm link">
            오늘의 일기 쓰기
          </Link>
        </div>

        {otpLoading && <LoadingState />}

        {!otpLoading && seedStatus === "unlocked" && !canReadEntries && (
          <div className="space-y-3">
            {otpBypassError && (
              <p role="alert" className="error-text">
                {otpBypassError}
              </p>
            )}
            <OtpGate>{null}</OtpGate>
          </div>
        )}

        {!otpLoading && seedStatus === "unlocked" && canReadEntries && (
          <>
            {!metadataLoaded && <LoadingState label="불러오는 중..." />}

            {metadataLoaded && metadata.length === 0 && (
              <div className="card space-y-3 text-center">
                <p className="muted">아직 작성한 일기가 없습니다.</p>
                <Link href="/write" className="btn-primary">
                  첫 일기 쓰기
                </Link>
              </div>
            )}

            {metadataLoaded && metadata.length > 0 && decrypting && (
              <LoadingState label="복호화하는 중..." />
            )}

            {metadataLoaded && metadata.length > 0 && !decrypting && (
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
          </>
        )}

        {!otpLoading && seedStatus !== "unlocked" && otpBlocking && (
          <div className="space-y-3">
            {decryptionMethods?.shamir && unlockMode === "shamir" ? (
              <form onSubmit={handleUnlock} className="space-y-3 card">
                <p className="muted">
                  백업 코드 {decryptionMethods.shamir.k}개를 입력하세요. OTP 코드 없이 바로 복구할
                  수 있습니다.
                </p>
                {shamirFields}
                {unlockError && (
                  <p role="alert" className="error-text">
                    {unlockError}
                  </p>
                )}
                <button type="submit" disabled={unlocking} className="btn-primary w-full">
                  {unlocking ? "확인 중..." : "잠금 해제"}
                </button>
                {modeSwitcherLinks}
              </form>
            ) : (
              <OtpGate
                footer={
                  decryptionMethods?.shamir && (
                    <button
                      type="button"
                      onClick={() => switchMode("shamir")}
                      className="w-full text-center text-xs link"
                    >
                      백업 코드가 있다면 OTP 없이 바로 복구
                    </button>
                  )
                }
              >
                {null}
              </OtpGate>
            )}
          </div>
        )}

        {!otpLoading && seedStatus !== "unlocked" && !otpBlocking && (
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

            {metadataLoaded && metadata.length > 0 && (
              <form onSubmit={handleUnlock} className="space-y-3 card">
                {unlockMode === "passphrase" ? (
                  <>
                    <p className="muted">
                      총 {metadata.length}개의 일기가 있습니다. 내용을 보려면 암호를 입력하세요.
                    </p>
                    <input
                      type="password"
                      required
                      autoFocus
                      autoComplete="current-password"
                      aria-label="암호"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="암호"
                      className="field"
                    />
                  </>
                ) : (
                  decryptionMethods?.shamir && (
                    <>
                      <p className="muted">백업 코드 {decryptionMethods.shamir.k}개를 입력하세요.</p>
                      {shamirFields}
                    </>
                  )
                )}
                {unlockError && (
                  <p role="alert" className="error-text">
                    {unlockError}
                  </p>
                )}
                <button type="submit" disabled={unlocking} className="btn-primary w-full">
                  {unlocking ? "확인 중..." : "잠금 해제"}
                </button>
                {modeSwitcherLinks}
              </form>
            )}
          </OtpGate>
        )}
      </div>
    </main>
  );
}
