"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useOtp } from "@/contexts/OtpContext";
import { useSeed } from "@/contexts/SeedContext";
import { OtpGate } from "@/components/OtpGate";
import { PasswordField } from "@/components/PasswordField";
import { EntryBrowser } from "@/components/EntryBrowser";
import { LoadingScreen, LoadingState } from "@/components/LoadingState";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAccountGate } from "@/hooks/useAccountGate";
import {
  listEntries,
  type EntrySequenceIntegrity,
  type StoredEntry,
} from "@/lib/firebase/entries";
import { ShamirNotConfiguredError } from "@/lib/firebase/otp";
import { BiometricGateError, haptic } from "@/lib/native/app";
import { BiometricGate } from "@/components/BiometricGate";
import { DiaryCover } from "@/components/DiaryCover";
import { Icon } from "@/components/Icon";
import {
  bytesToBase64,
  computeShamirOtpBypassProof,
  textToRecoverySecret,
  InvalidShamirSharesError,
  WrongPassphraseError,
} from "@/lib/crypto";

type UnlockMode = "passphrase" | "shamir";

/**
 * The biometric check (Android app) is a gate in front of the passphrase
 * (components/BiometricGate), so the passphrase paths only see it if
 * something rendered the form without that gate — SeedContext refuses.
 */
function biometricGateMessage(code: string): string | null {
  switch (code) {
    case "cancelled":
      return null;
    case "required":
      return "생체 인증을 먼저 해 주세요.";
    default:
      return "생체 인증을 확인하지 못했어요. 다시 시도해 주세요.";
  }
}

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
  const { user } = useAuth();
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
  usePageTitle("일기장");
  const ready = useAccountGate();
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
                ? "백업 코드가 없어서 2단계 인증을 건너뛸 수 없어요."
                : "2단계 인증을 건너뛰지 못했어요. 아래에 인증 앱의 숫자를 넣거나, 새로고침한 뒤 다시 시도해 주세요."
            );
          }
        }
      }
    } catch (err) {
      if (err instanceof BiometricGateError) {
        setUnlockError(biometricGateMessage(err.code));
        return;
      }
      haptic("reject");
      setUnlockError(
        err instanceof WrongPassphraseError
          ? "일기 암호를 다시 확인해 주세요."
          : err instanceof InvalidShamirSharesError
            ? "백업 코드를 다시 확인해 주세요."
            : "일기장을 열지 못했어요. 다시 시도해 주세요."
      );
    } finally {
      setUnlocking(false);
    }
  }

  if (!ready) {
    return <LoadingScreen />;
  }

  const otherModes: { mode: UnlockMode; label: string }[] = [
    { mode: "passphrase" as const, label: "일기 암호로 열기" },
    ...(decryptionMethods?.shamir
      ? [{ mode: "shamir" as const, label: "백업 코드로 열기" }]
      : []),
  ].filter((m) => m.mode !== unlockMode);

  const shamirFields = (
    <>
      {shareInputs.map((value, i) => (
        <div key={i}>
          <label htmlFor={`share-${i}`} className="field-label">
            백업 코드 {i + 1}
          </label>
          <input
            id={`share-${i}`}
            type="text"
            required
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            onChange={(e) =>
              setShareInputs((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
            }
            className="field-mono"
          />
        </div>
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
          className="btn-text w-full"
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
    <div className="card space-y-4 py-9 text-center">
      <div className="space-y-1.5">
        <p className="text-[1.0625rem] font-bold">첫 일기를 써 보세요</p>
        <p className="muted text-sm">쓴 일기는 나만 열 수 있게 잠겨서 여기에 모여요.</p>
      </div>
      <Link href="/write" className="btn-primary">
        쓰기
      </Link>
    </div>
  );

  const unlockForm = (
    <form onSubmit={handleUnlock} className="card space-y-4">
      {unlockMode === "passphrase" ? (
        <>
          <PasswordField
            label="일기 암호"
            autoFocus
            autoComplete="passphrase"
            value={passphrase}
            onChange={setPassphrase}
          />
        </>
      ) : (
        decryptionMethods?.shamir && (
          <>
            <p className="muted">백업 코드 {decryptionMethods.shamir.k}개를 넣어 주세요. 일기 암호를 잊었을 때 쓰는 방법이에요.</p>
            {shamirFields}
          </>
        )
      )}
      {unlockError && (
        <p role="alert" className="error-text">
          {unlockError}
        </p>
      )}
      <button type="submit" disabled={unlocking} className="btn-primary min-h-14 w-full rounded-2xl text-[1.0625rem]">
        {unlocking ? "여는 중…" : "일기장 열기"}
      </button>
      {modeSwitcherLinks}
    </form>
  );

  const lockButton = (
    <button
      type="button"
      onClick={() => lock("manual")}
      className="btn btn-sm min-h-9 bg-surface text-ink hover:bg-fill"
    >
      <Icon name="lock" size={16} strokeWidth={2} />
      잠그기
    </button>
  );

  // The locked diary's cover, from the metadata alone. `metadata` arrives
  // newest-first (entrySeq desc).
  const cover = metadata.length > 0 && (
    <DiaryCover
      total={metadata.length}
      first={metadata[metadata.length - 1].createdAt?.toDate?.() ?? null}
      last={metadata[0].createdAt?.toDate?.() ?? null}
      compact={unlockMode === "shamir"}
    />
  );

  return (
    <main className="flex flex-1 flex-col items-center px-5 pb-10 pt-4 sm:px-6 sm:py-12">
      <div className={`w-full space-y-5 ${browsing ? "max-w-xl lg:max-w-5xl" : "max-w-md"}`}>
        <div className="space-y-1.5">
          <div className="flex min-h-11 items-center justify-end sm:hidden">
            {seedStatus === "unlocked" && lockButton}
          </div>
          <div className="flex items-end justify-between gap-3">
            <h1 className="title-display">일기장</h1>
            <span className="hidden sm:block">{seedStatus === "unlocked" && lockButton}</span>
          </div>
          {/* Explains a session that locked itself out from under the reader
              (contexts/SeedContext.tsx's inactivity timer) — otherwise the
              list just vanishes back into a passphrase prompt with no reason
              given, which reads like a bug. */}
          {seedStatus === "locked" && (lockReason === "idle" || lockReason === "background") && (
            <p role="status" className="flex items-center gap-1.5 text-sm text-ink-2">
              <Icon name="clock" size={16} strokeWidth={2} />
              {lockReason === "idle" ? "한동안 쓰지 않아서 일기장을 잠갔어요" : "앱을 나가서 일기장을 잠갔어요"}
            </p>
          )}
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

        {!otpLoading && seedStatus === "unlocked" && canReadEntries && privateKeys && (
          <>
            {!metadataLoaded && <LoadingState label="불러오는 중…" />}

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
                  백업 코드 {decryptionMethods.shamir.k}개를 넣어 주세요. 2단계 인증 없이 바로 열 수 있어요.
                </p>
                {shamirFields}
                {unlockError && (
                  <p role="alert" className="error-text">
                    {unlockError}
                  </p>
                )}
                <button type="submit" disabled={unlocking} className="btn-primary min-h-14 w-full rounded-2xl text-[1.0625rem]">
                  {unlocking ? "여는 중…" : "일기장 열기"}
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
                      className="btn-text w-full"
                    >
                      백업 코드로 바로 열기
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
            {!metadataLoaded && <LoadingState label="불러오는 중…" />}

            {metadataLoaded && metadata.length === 0 && emptyState}

            {metadataLoaded && cover}

            {metadataLoaded && metadata.length > 0 &&
              (unlockMode === "shamir" ? (
                unlockForm
              ) : (
                // Like OTP: the biometric check comes before the passphrase
                // can even be tried; the backup codes are the way around it.
                <BiometricGate
                  footer={
                    decryptionMethods?.shamir && (
                      <button type="button" onClick={() => switchMode("shamir")} className="btn-text w-full">
                        백업 코드로 바로 열기
                      </button>
                    )
                  }
                >
                  {unlockForm}
                </BiometricGate>
              ))}
          </OtpGate>
        )}
      </div>
    </main>
  );
}
