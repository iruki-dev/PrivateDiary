"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useOtp } from "@/contexts/OtpContext";
import { useSeed } from "@/contexts/SeedContext";
import { OtpGate } from "@/components/OtpGate";
import { EntryBrowser } from "@/components/EntryBrowser";
import { LoadingScreen, LoadingState } from "@/components/LoadingState";
import { usePageTitle } from "@/hooks/usePageTitle";
import {
  listEntries,
  type EntrySequenceIntegrity,
  type StoredEntry,
} from "@/lib/firebase/entries";
import { ShamirNotConfiguredError } from "@/lib/firebase/otp";
import {
  bytesToBase64,
  computeShamirOtpBypassProof,
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
 * This page owns the GATES — auth, OTP, and which credential unlocks the
 * seed. Everything past them (search, grouping, incremental decryption,
 * export) lives in components/EntryBrowser.tsx, which only ever runs with
 * private keys already in hand.
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
    lock,
    lockReason,
    decryptionMethods,
  } = useSeed();
  const { loading: otpLoading, otpEnabled, otpVerified, verifyViaShamirBypass } = useOtp();
  const router = useRouter();
  usePageTitle("지난 일기");
  const canReadEntries = !otpLoading && (!otpEnabled || otpVerified);
  const otpBlocking = !otpLoading && otpEnabled && !otpVerified;

  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const [metadata, setMetadata] = useState<StoredEntry[]>([]);
  // Sequence-level integrity of the fetched list (lib/firebase/entries.ts's
  // checkEntrySequence). Per-entry tampering already surfaces as a
  // decryption failure via the AAD binding; this catches the case that
  // binding structurally cannot — entries that are simply missing.
  const [integrity, setIntegrity] = useState<EntrySequenceIntegrity | null>(null);

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
      .then((result) => {
        if (cancelled) return;
        setMetadata(result.entries);
        setIntegrity(result.integrity);
        setMetadataLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setMetadataLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user, canReadEntries]);

  // Incremental decryption (native-integrity check, chunking, per-entry
  // failure isolation including the payload: null case from
  // lib/firebase/entries.ts's listEntries()) now lives in
  // hooks/useDecryptedEntries.ts, used by components/EntryBrowser.tsx below
  // — this page only owns the gates above that decision.
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

  // The reading view earns a second column on wide screens (calendar +
  // statistics beside the list); every gate before it stays a single
  // narrow column, where a 5xl-wide passphrase form would look lost.
  const browsing =
    !otpLoading &&
    seedStatus === "unlocked" &&
    canReadEntries &&
    !!privateKeys &&
    metadataLoaded &&
    metadata.length > 0;

  const emptyState = (
    <div className="card space-y-3 text-center">
      <p className="muted">아직 작성한 일기가 없습니다.</p>
      <Link href="/write" className="btn-primary">
        첫 일기 쓰기
      </Link>
    </div>
  );

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-10 sm:px-6 sm:py-16">
      <div className={`w-full space-y-6 ${browsing ? "max-w-xl lg:max-w-5xl" : "max-w-xl"}`}>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">지난 일기</h1>
          <div className="flex items-center gap-3">
            {seedStatus === "unlocked" && (
              <button type="button" onClick={() => lock("manual")} className="text-sm link">
                잠그기
              </button>
            )}
            <Link href="/write" className="text-sm link">
              오늘의 일기 쓰기
            </Link>
          </div>
        </div>

        {/* Explains a session that locked itself out from under the reader
            (contexts/SeedContext.tsx's inactivity timer) — otherwise the
            list just vanishes back into a passphrase prompt with no reason
            given, which reads like a bug. */}
        {seedStatus === "locked" && lockReason === "idle" && (
          <p role="status" className="muted text-xs">
            일정 시간 사용하지 않아 자동으로 잠갔습니다. 설정에서 시간을 바꿀 수 있습니다.
          </p>
        )}

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

        {!otpLoading && seedStatus === "unlocked" && canReadEntries && privateKeys && (
          <>
            {!metadataLoaded && <LoadingState label="불러오는 중..." />}

            {metadataLoaded && metadata.length === 0 && emptyState}

            {metadataLoaded && metadata.length > 0 && (
              <EntryBrowser
                entries={metadata}
                integrity={integrity}
                privateKeys={privateKeys}
              />
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

            {metadataLoaded && metadata.length === 0 && emptyState}

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
