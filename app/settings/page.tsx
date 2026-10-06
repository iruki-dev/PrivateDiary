"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useOtp } from "@/contexts/OtpContext";
import { OtpGate } from "@/components/OtpGate";
import { BiometricGate } from "@/components/BiometricGate";
import { useSeed } from "@/contexts/SeedContext";
import { usePreferences } from "@/contexts/PreferencesContext";
import { checkPassphraseStrength } from "@/lib/passphraseStrength";
import { PassphraseStrengthMeter } from "@/components/PassphraseStrengthMeter";
import { PasswordField, TextField } from "@/components/PasswordField";
import { SecretReveal } from "@/components/SecretReveal";
import { SecretCard } from "@/components/SecretCard";
import { OtpQrCard } from "@/components/OtpQrCard";
import { AccountGateFallback } from "@/components/AccountGateFallback";
import { useAccount } from "@/contexts/AccountContext";
import {
  EraseLocalDiaryRow,
  LeaveLocalModeRow,
  LocalModeRow,
  NetworkBlockRow,
  PhoneBackupRow,
} from "@/components/settings/DeviceRows";
import { deleteBackup } from "@/lib/store/backup";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAccountGate } from "@/hooks/useAccountGate";
import { AccountGroup } from "@/components/settings/AccountGroup";
import { BiometricGateRow } from "@/components/settings/BiometricGateRow";
import { IS_ANDROID_APP } from "@/lib/platform";
import {
  MoreLink,
  SettingsGroup,
  SettingsLinkRow,
  SettingsRow,
  Switch,
} from "@/components/settings/ui";
import {
  CREDENTIAL_ERRORS,
  CredentialProof,
  FormError,
  PanelActions,
  ReauthPanel,
  type CredentialMode,
} from "@/components/settings/forms";
import { AUTO_LOCK_CHOICES, DAILY_ENTRY_LIMIT_CHOICES } from "@/lib/preferences";
import { clearAllDrafts } from "@/lib/drafts";
import {
  deleteAccount,
  IncorrectOtpCodeError,
  OtpLockedOutError,
  ReauthRequiredError,
  type OtpSetupMaterial,
} from "@/lib/firebase/otp";
import {
  reauthenticateWithGoogle,
  reauthenticateWithPassword,
  signOut,
} from "@/lib/firebase/auth";
import { authErrorCode } from "@/lib/firebase/authErrors";
import {
  InvalidShamirSharesError,
  WrongPassphraseError,
  recoverySecretToText,
  textToRecoverySecret,
  type DecryptionMethodsConfig,
} from "@/lib/crypto";
import { docHref } from "@/lib/site";

type ShamirConfig = { n: number; k: number } | null;

function emptyShares(config: ShamirConfig): string[] {
  return config ? Array(config.k).fill("") : [];
}

function credentialErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof WrongPassphraseError) return CREDENTIAL_ERRORS.wrongPassphrase;
  if (err instanceof InvalidShamirSharesError) return CREDENTIAL_ERRORS.wrongShares;
  if (err instanceof ReauthRequiredError) return CREDENTIAL_ERRORS.recentLogin;
  return fallback;
}

function reauthErrorMessage(err: unknown): string {
  switch (authErrorCode(err)) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
      return "로그인 비밀번호를 다시 확인해 주세요.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "다시 로그인하지 않고 닫았어요.";
    default:
      return "다시 로그인하지 못했어요. 다시 시도해 주세요.";
  }
}

function useIsGoogleAccount(): boolean {
  const { user } = useAuth();
  // Google-signed-in users have no login password to re-enter — see
  // lib/firebase/auth.ts's reauthenticateWithGoogle doc comment.
  return user?.providerData.some((p) => p.providerId === "google.com") ?? false;
}

/**
 * /settings as grouped rows: label, one line of description, a control.
 * Anything that needs explaining links to the help docs instead of being
 * explained here. Flows that need room (proving the passphrase, showing new
 * backup codes) open inside their own row.
 *
 * OTP gate: every group except 계정 mutates something firestore.rules only
 * releases when otpSatisfied() (credential-bearing fields on users/{uid},
 * and `security`/`preferences`), so they sit behind OtpGate — without it
 * the forms would render, accept input, and fail with a bare
 * permission-denied. The OTP row itself is inside too: disabling OTP needs
 * a current code anyway, so passing the gate first costs nothing.
 *
 * The gate's footer keeps the lost-OTP-device case recoverable: the backup
 * code entry on /entries satisfies the same gate via verifyShamirOtpBypass
 * (no TOTP code), and the claims it stamps are good for 12h — so coming
 * back here afterwards just works.
 */
export default function SettingsPage() {
  const {
    changePassphrase,
    resetPassphraseWithShamirShares,
    decryptionMethods,
    stageSeedFromPassphrase,
    stageSeedFromShamirShares,
    discardStagedSeed,
    prepareShamir,
    confirmPendingShamir,
    disableShamir,
  } = useSeed();
  usePageTitle("설정");
  const ready = useAccountGate();
  const { account } = useAccount();

  if (!ready) {
    return <AccountGateFallback />;
  }

  const shamirConfig = decryptionMethods?.shamir ?? null;
  const kind = account?.kind ?? "cloud";

  // The phone's read-only copy of an account: nothing here can change it.
  if (kind === "backup") {
    return (
      <main className="flex flex-1 flex-col items-center px-5 pb-10 pt-4 sm:px-6 sm:py-12">
        <div className="w-full max-w-xl space-y-7">
          <h1 className="title-display pt-11 sm:pt-0">설정</h1>
          <AccountGroup />
        </div>
      </main>
    );
  }

  const local = kind === "local";

  return (
    <main className="flex flex-1 flex-col items-center px-5 pb-10 pt-4 sm:px-6 sm:py-12">
      <div className="w-full max-w-xl space-y-7">
        <h1 className="title-display pt-11 sm:pt-0">설정</h1>

        <OtpGate
          footer={
            shamirConfig && (
              <Link href="/entries" className="btn-text w-full text-center text-sm">
                인증 앱이 없다면 백업 코드로 일기장을 연 뒤 다시 오세요
              </Link>
            )
          }
        >
          {/* Same as OTP: the biometric check (Android app) comes before
              anything here that takes the diary passphrase. */}
          <BiometricGate
            footer={
              shamirConfig && (
                <Link href="/entries" className="btn-text w-full text-center text-sm">
                  생체 인증을 할 수 없다면 백업 코드로 일기장을 연 뒤 다시 오세요
                </Link>
              )
            }
          >
            <div className="space-y-8">
              <SettingsGroup id="security" title="일기장 지키기">
                <ShamirRow
                  config={shamirConfig}
                  stageSeedFromPassphrase={stageSeedFromPassphrase}
                  stageSeedFromShamirShares={stageSeedFromShamirShares}
                  discardStagedSeed={discardStagedSeed}
                  prepareShamir={prepareShamir}
                  confirmPendingShamir={confirmPendingShamir}
                  disableShamir={disableShamir}
                />
                <ChangePassphraseRow changePassphrase={changePassphrase} />
                {shamirConfig && (
                  <ResetPassphraseRow
                    config={shamirConfig}
                    resetPassphraseWithShamirShares={resetPassphraseWithShamirShares}
                  />
                )}
                <AutoLockRow />
                {/* 2-step verification is the server's gate; a local diary has no server. */}
                {!local && (
                  <OtpRow
                    stageSeedFromPassphrase={stageSeedFromPassphrase}
                    discardStagedSeed={discardStagedSeed}
                  />
                )}
                {/* Same footing as OTP: an extra check, never a replacement for the passphrase. */}
                {IS_ANDROID_APP && <BiometricGateRow />}
              </SettingsGroup>

              <SettingsGroup id="writing" title="쓰기">
                <PrivateWritingRows />
                <DraftAutosaveRow />
                {/* The daily limit bounds what a stolen session can pile onto
                    the server (functions/src/entryRateLimit.ts); nothing to
                    bound on a diary that never leaves the phone. */}
                {!local && (
                  <DailyEntryLimitRow
                    shamirConfig={shamirConfig}
                    stageSeedFromPassphrase={stageSeedFromPassphrase}
                    stageSeedFromShamirShares={stageSeedFromShamirShares}
                    discardStagedSeed={discardStagedSeed}
                  />
                )}
              </SettingsGroup>

              <SettingsGroup id="data" title="데이터">
                <SettingsLinkRow
                  href="/entries"
                  label="일기 내보내기 · 불러오기"
                  description="일기장 맨 아래에서 파일로 받거나, 받은 파일에서 다시 가져올 수 있어요"
                />
                {IS_ANDROID_APP && !local && <PhoneBackupRow />}
                {IS_ANDROID_APP && !local && <LocalModeRow />}
                {local && <NetworkBlockRow />}
                {local && <LeaveLocalModeRow />}
                {local ? (
                  <EraseLocalDiaryRow />
                ) : (
                  <DeleteAccountRow
                    stageSeedFromPassphrase={stageSeedFromPassphrase}
                    stageSeedFromShamirShares={stageSeedFromShamirShares}
                    discardStagedSeed={discardStagedSeed}
                    decryptionMethods={decryptionMethods}
                  />
                )}
              </SettingsGroup>
            </div>
          </BiometricGate>
        </OtpGate>

        <AccountGroup />
      </div>
    </main>
  );
}

/**
 * Two display-only toggles for /write (ARCHITECTURE.md §3.9): blur while
 * typing, and whether the hold-to-peek icon exists at all. Pure display
 * layer — never touches encryption — but `preferences` is OTP-gated as a
 * whole, so these render inside the gate with everything else.
 */
function PrivateWritingRows() {
  const {
    loading,
    privateWritingMode,
    privateWritingPeekAllowed,
    setPrivateWritingMode,
    setPrivateWritingPeekAllowed,
  } = usePreferences();
  const local = useAccount().account?.kind === "local";

  if (loading) return null;

  return (
    <>
      <SettingsRow
        label="쓰는 글 가리기"
        description={
          local
            ? "옆 사람이 보지 못하게 쓰는 동안 글자를 흐리게 보여줘요."
            : "옆 사람이 보지 못하게 쓰는 동안 글자를 흐리게 보여줘요. 모든 기기에 적용돼요."
        }
        control={
          <Switch
            label="쓰는 글 가리기"
            checked={privateWritingMode}
            onChange={(next) => void setPrivateWritingMode(next)}
          />
        }
      />
      {privateWritingMode && (
        <SettingsRow
          label="누르고 있으면 보이기"
          description="끄면 쓰는 동안에는 나도 글을 볼 수 없어요."
          control={
            <Switch
              label="누르고 있으면 보이기"
              checked={privateWritingPeekAllowed}
              onChange={(next) => void setPrivateWritingPeekAllowed(next)}
            />
          }
        />
      )}
    </>
  );
}

/**
 * Auto-lock and drafts live in `users/{uid}.security` (lib/preferences.ts),
 * separate from the cosmetic `preferences` so it can be gated like a
 * credential-bearing field: firestore.rules' credentialMutationAllowed()
 * requires a valid OTP session or — without OTP — a sign-in within the
 * last few minutes (isRecentAuth()). On a long-open session that surfaces
 * as ReauthRequiredError, explained rather than shown as a bare failure.
 */
function AutoLockRow() {
  const { loading, autoLockMinutes, setAutoLockMinutes } = usePreferences();
  const [error, setError] = useState<string | null>(null);

  if (loading) return null;

  async function handleChange(minutes: number) {
    setError(null);
    try {
      await setAutoLockMinutes(minutes);
    } catch (err) {
      setError(credentialErrorMessage(err, "자동 잠금 시간을 바꾸지 못했어요."));
    }
  }

  return (
    <SettingsRow
      label="자동 잠금"
      htmlFor="auto-lock-minutes"
      description={
        IS_ANDROID_APP
          ? "쓰지 않는 동안 일기장을 잠가요. 앱을 나가면 시간과 상관없이 바로 잠가요."
          : "쓰지 않는 동안 일기장을 잠가요."
      }
      control={
        <select
          id="auto-lock-minutes"
          value={autoLockMinutes}
          onChange={(event) => void handleChange(Number(event.target.value))}
          className="field w-auto py-2 pr-8"
        >
          {AUTO_LOCK_CHOICES.map((choice) => (
            <option key={choice.minutes} value={choice.minutes}>
              {choice.label}
            </option>
          ))}
        </select>
      }
    >
      {error && <FormError>{error}</FormError>}
    </SettingsRow>
  );
}

function DraftAutosaveRow() {
  const { loading, draftAutosave, setDraftAutosave } = usePreferences();
  const [error, setError] = useState<string | null>(null);

  if (loading) return null;

  async function handleChange(next: boolean) {
    setError(null);
    try {
      await setDraftAutosave(next);
      // Turning it off has to remove what is already stored on this
      // device, otherwise the setting reads as "no plaintext here" while
      // yesterday's draft is still sitting in localStorage. Done only
      // after the write succeeds — a failed write must not clear a draft
      // the setting change never actually took effect for.
      if (!next) clearAllDrafts();
    } catch (err) {
      setError(credentialErrorMessage(err, "임시 저장을 바꾸지 못했어요."));
    }
  }

  return (
    <SettingsRow
      label="임시 저장"
      description={
        <>
          쓰던 글을 이 기기에 남겨 둬요. 저장하기 전까지는 잠기지 않은 채로 남아요.{" "}
          <MoreLink href={docHref("/docs/writing#draft")} />
        </>
      }
      control={<Switch label="임시 저장" checked={draftAutosave} onChange={(next) => void handleChange(next)} />}
    >
      {error && <FormError>{error}</FormError>}
    </SettingsRow>
  );
}

/**
 * PENTEST FINDING F-2 follow-up: changing `security.dailyEntryLimit`
 * requires proving the actual master credential (passphrase or K backup
 * codes) first, exactly like issuing backup codes does — a stolen-but-
 * recent session is not enough on its own to raise or disable the limit
 * that bounds mass entry injection.
 *
 * Two independent layers, same shape as DeleteAccountRow:
 *  1. CLIENT-SIDE: stageSeedFromPassphrase/stageSeedFromShamirShares — a
 *     local AES-GCM unwrap or Shamir combine the server never sees. Only
 *     proving possession is needed, so the staged seed is discarded at once.
 *  2. SERVER-SIDE: credentialMutationAllowed() still gates the Firestore
 *     write itself, since the server can't verify a passphrase at all
 *     (rule 1) and this remains the only proof it CAN check.
 */
function DailyEntryLimitRow({
  shamirConfig,
  stageSeedFromPassphrase,
  stageSeedFromShamirShares,
  discardStagedSeed,
}: {
  shamirConfig: ShamirConfig;
  stageSeedFromPassphrase: (passphrase: string) => Promise<void>;
  stageSeedFromShamirShares: (shares: Uint8Array[]) => Promise<void>;
  discardStagedSeed: () => void;
}) {
  const { loading, dailyEntryLimit, setDailyEntryLimit } = usePreferences();
  const [open, setOpen] = useState(false);
  const [proveMode, setProveMode] = useState<CredentialMode>("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [shareInputs, setShareInputs] = useState<string[]>(emptyShares(shamirConfig));
  const [newLimit, setNewLimit] = useState(dailyEntryLimit);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => () => discardStagedSeed(), [discardStagedSeed]);

  if (loading) return null;

  const currentLabel =
    DAILY_ENTRY_LIMIT_CHOICES.find((c) => c.limit === dailyEntryLimit)?.label ?? `하루 ${dailyEntryLimit}개`;

  function cancel() {
    discardStagedSeed();
    setOpen(false);
    setProveMode("passphrase");
    setPassphrase("");
    setShareInputs(emptyShares(shamirConfig));
    setError(null);
  }

  function start() {
    setError(null);
    setMessage(null);
    setNewLimit(dailyEntryLimit);
    setOpen(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (proveMode === "passphrase") {
        await stageSeedFromPassphrase(passphrase);
      } else {
        await stageSeedFromShamirShares(shareInputs.map((s) => textToRecoverySecret(s)));
      }
      // Only proving possession — the limit change itself doesn't need the seed.
      discardStagedSeed();
      setPassphrase("");
      await setDailyEntryLimit(newLimit);
      setOpen(false);
      setMessage("바꿨어요");
    } catch (err) {
      setError(credentialErrorMessage(err, "하루에 쓸 수 있는 일기 수를 바꾸지 못했어요."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SettingsRow
      label="하루에 쓸 수 있는 일기"
      description={
        <>
          {currentLabel}
          {message && <span className="text-ink"> · {message}</span>}{" "}
          <MoreLink href={docHref("/docs/writing#daily-limit")} />
        </>
      }
      control={
        !open && (
          <button type="button" onClick={start} className="btn-secondary btn-sm">
            변경
          </button>
        )
      }
    >
      {open && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="daily-entry-limit-new" className="field-label">
              새 한도
            </label>
            <select
              id="daily-entry-limit-new"
              value={newLimit}
              onChange={(event) => setNewLimit(Number(event.target.value))}
              className="field"
            >
              {DAILY_ENTRY_LIMIT_CHOICES.map((choice) => (
                <option key={choice.limit} value={choice.limit}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>
          <p className="muted">바꾸려면 본인 확인이 필요해요.</p>
          <CredentialProof
            mode={proveMode}
            onModeChange={setProveMode}
            shamirK={shamirConfig?.k ?? null}
            passphrase={passphrase}
            onPassphraseChange={setPassphrase}
            shares={shareInputs}
            onSharesChange={setShareInputs}
            autoFocus={false}
          />
          <FormError>{error}</FormError>
          <PanelActions submitLabel="바꾸기" busy={submitting} onCancel={cancel} />
        </form>
      )}
    </SettingsRow>
  );
}

function ChangePassphraseRow({
  changePassphrase,
}: {
  changePassphrase: (oldPassphrase: string, newPassphrase: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [oldPassphrase, setOldPassphrase] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function cancel() {
    setOpen(false);
    setOldPassphrase("");
    setNewPassphrase("");
    setConfirmPassphrase("");
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassphrase !== confirmPassphrase) {
      setError("새 일기 암호를 두 칸에 똑같이 넣어 주세요.");
      return;
    }
    if (!checkPassphraseStrength(newPassphrase).isStrongEnough) {
      setError("새 일기 암호가 너무 짧아요. 서로 상관없는 단어를 더 이어 붙여 보세요.");
      return;
    }

    setSubmitting(true);
    try {
      await changePassphrase(oldPassphrase, newPassphrase);
      setSuccess(true);
      cancel();
    } catch (err) {
      setError(
        err instanceof WrongPassphraseError ? "지금 일기 암호를 다시 확인해 주세요." : "일기 암호를 바꾸지 못했어요."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SettingsRow
      label="일기 암호"
      description={success ? <span className="text-ink">일기 암호를 바꿨어요</span> : "일기장을 여는 암호를 바꿔요"}
      control={
        !open && (
          <button
            type="button"
            onClick={() => {
              setSuccess(false);
              setOpen(true);
            }}
            className="btn-secondary btn-sm"
          >
            변경
          </button>
        )
      }
    >
      {open && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <PasswordField
            label="지금 일기 암호"
            autoComplete="passphrase"
            autoFocus
            value={oldPassphrase}
            onChange={setOldPassphrase}
          />
          <div className="space-y-2">
            <PasswordField
              label="새 일기 암호"
              autoComplete="passphrase"
              value={newPassphrase}
              onChange={setNewPassphrase}
            />
            <PassphraseStrengthMeter passphrase={newPassphrase} />
          </div>
          <PasswordField
            label="새 일기 암호 확인"
            autoComplete="passphrase"
            value={confirmPassphrase}
            onChange={setConfirmPassphrase}
          />
          <FormError>{error}</FormError>
          <PanelActions submitLabel="바꾸기" busyLabel="바꾸는 중…" busy={submitting} onCancel={cancel} />
        </form>
      )}
    </SettingsRow>
  );
}

/**
 * Passphrase reset via Shamir shares ("백업 코드" in the UI) — for when the
 * passphrase itself is forgotten. No old passphrase is needed; K shares
 * prove the same underlying master credential (contexts/SeedContext.tsx).
 * Only shown once Shamir is configured.
 */
function ResetPassphraseRow({
  config,
  resetPassphraseWithShamirShares,
}: {
  config: { n: number; k: number };
  resetPassphraseWithShamirShares: (shares: Uint8Array[], newPassphrase: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [shareInputs, setShareInputs] = useState<string[]>(Array(config.k).fill(""));
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function cancel() {
    setOpen(false);
    setShareInputs(Array(config.k).fill(""));
    setNewPassphrase("");
    setConfirmPassphrase("");
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassphrase !== confirmPassphrase) {
      setError("새 일기 암호를 두 칸에 똑같이 넣어 주세요.");
      return;
    }
    if (!checkPassphraseStrength(newPassphrase).isStrongEnough) {
      setError("새 일기 암호가 너무 짧아요. 서로 상관없는 단어를 더 이어 붙여 보세요.");
      return;
    }

    setSubmitting(true);
    try {
      await resetPassphraseWithShamirShares(
        shareInputs.map((s) => textToRecoverySecret(s)),
        newPassphrase
      );
      setSuccess(true);
      cancel();
    } catch (err) {
      if (!(err instanceof InvalidShamirSharesError)) console.error("resetPassphraseWithShamirShares failed", err);
      setError(err instanceof InvalidShamirSharesError ? CREDENTIAL_ERRORS.wrongShares : "새 일기 암호를 정하지 못했어요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SettingsRow
      label="일기 암호를 잊었다면"
      description={
        success ? (
          <span className="text-ink">새 일기 암호를 정했어요</span>
        ) : (
          `백업 코드 ${config.k}개로 새 일기 암호를 정해요. 일기는 그대로 남아요.`
        )
      }
      control={
        !open && (
          <button
            type="button"
            onClick={() => {
              setSuccess(false);
              setOpen(true);
            }}
            className="btn-secondary btn-sm"
          >
            재설정
          </button>
        )
      }
    >
      {open && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <CredentialProof
            mode="shamir"
            onModeChange={() => {}}
            shamirK={config.k}
            passphrase=""
            onPassphraseChange={() => {}}
            shares={shareInputs}
            onSharesChange={setShareInputs}
          />
          <div className="space-y-2">
            <PasswordField
              label="새 일기 암호"
              autoComplete="passphrase"
              value={newPassphrase}
              onChange={setNewPassphrase}
            />
            <PassphraseStrengthMeter passphrase={newPassphrase} />
          </div>
          <PasswordField
            label="새 일기 암호 확인"
            autoComplete="passphrase"
            value={confirmPassphrase}
            onChange={setConfirmPassphrase}
          />
          <FormError>{error}</FormError>
          <PanelActions submitLabel="새 암호 정하기" busyLabel="정하는 중…" busy={submitting} onCancel={cancel} />
        </form>
      )}
    </SettingsRow>
  );
}

/**
 * OTP (TOTP authenticator app) as an access gate — see
 * functions/src/index.ts and contexts/OtpContext.tsx for why this is a
 * server-verified gate rather than a cryptographic factor.
 *
 * Enabling asks for the passphrase first ("prove a master credential before
 * changing account security"), but that local unwrap is not what protects
 * enrollment — the server can't see it. security-patch-v2: the
 * server-verifiable gate is requireRecentAuth() in functions/src/index.ts.
 * When startSetup() reports it (ReauthRequiredError), this drops into a
 * "reauth" phase that proves the LOGIN credential instead (password or a
 * fresh Google popup), which the server CAN verify via auth_time, then
 * retries. Disabling requires a currently-valid code.
 */
type OtpPhase = "status" | "confirm-passphrase" | "reauth" | "setup" | "disable";

function OtpRow({
  stageSeedFromPassphrase,
  discardStagedSeed,
}: {
  stageSeedFromPassphrase: (passphrase: string) => Promise<void>;
  discardStagedSeed: () => void;
}) {
  const { user } = useAuth();
  const { loading, otpEnabled, startSetup, confirmSetup, disable } = useOtp();
  const isGoogleAccount = useIsGoogleAccount();
  const [phase, setPhase] = useState<OtpPhase>("status");
  const [passphrase, setPassphrase] = useState("");
  const [reauthPassword, setReauthPassword] = useState("");
  const [setupMaterial, setSetupMaterial] = useState<OtpSetupMaterial | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function otpErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof IncorrectOtpCodeError) return "인증 앱의 숫자를 다시 확인해 주세요.";
    if (err instanceof OtpLockedOutError) return "여러 번 틀려서 잠시 막아 두었어요. 1분 뒤에 다시 시도해 주세요.";
    return fallback;
  }

  // Shared by both entry points into setup (passphrase step and the reauth
  // retry) so ReauthRequiredError is handled in exactly one place.
  async function beginOtpSetup() {
    try {
      const material = await startSetup();
      setSetupMaterial(material);
      setPhase("setup");
    } catch (err) {
      if (err instanceof ReauthRequiredError) {
        setError(null);
        setPhase("reauth");
        return;
      }
      throw err;
    }
  }

  async function handleConfirmPassphrase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Only proving identity — OTP setup doesn't need the seed itself, so
      // it's discarded right away rather than left staged.
      await stageSeedFromPassphrase(passphrase);
      discardStagedSeed();
      setPassphrase("");
      await beginOtpSetup();
    } catch (err) {
      setError(
        err instanceof WrongPassphraseError ? CREDENTIAL_ERRORS.wrongPassphrase : "2단계 인증을 설정하지 못했어요."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReauthPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setError(null);
    setSubmitting(true);
    try {
      await reauthenticateWithPassword(user, reauthPassword);
      setReauthPassword("");
      await beginOtpSetup();
    } catch (err) {
      setError(reauthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReauthGoogle() {
    if (!user) return;
    setError(null);
    setSubmitting(true);
    try {
      await reauthenticateWithGoogle(user);
      await beginOtpSetup();
    } catch (err) {
      setError(reauthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await confirmSetup(code);
      setCode("");
      setSetupMaterial(null);
      setPhase("status");
      setMessage("켰어요");
    } catch (err) {
      setError(otpErrorMessage(err, "확인하지 못했어요."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDisable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await disable(code);
      setCode("");
      setPhase("status");
      setMessage("껐어요");
    } catch (err) {
      setError(otpErrorMessage(err, "끄지 못했어요."));
    } finally {
      setSubmitting(false);
    }
  }

  function cancel() {
    discardStagedSeed();
    setPhase("status");
    setSetupMaterial(null);
    setPassphrase("");
    setReauthPassword("");
    setCode("");
    setError(null);
  }

  if (loading) return null;

  const codeField = (
    <TextField
      label="인증 앱의 6자리 숫자"
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus
      value={code}
      onChange={setCode}
      placeholder="123456"
    />
  );

  return (
    <SettingsRow
      label="2단계 인증"
      description={
        <>
          {otpEnabled ? "켜짐" : "꺼짐"} · 일기장을 열기 전에 인증 앱의 숫자를 한 번 더 확인해요
          {message && <span className="text-ink"> · {message}</span>}{" "}
          <MoreLink href={docHref("/docs/otp")} />
        </>
      }
      control={
        phase === "status" && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setMessage(null);
              setPhase(otpEnabled ? "disable" : "confirm-passphrase");
            }}
            className="btn-secondary btn-sm"
          >
            {otpEnabled ? "끄기" : "켜기"}
          </button>
        )
      }
    >
      {phase === "confirm-passphrase" && (
        <form onSubmit={handleConfirmPassphrase} className="space-y-4">
          <PasswordField
            label="일기 암호"
            autoComplete="passphrase"
            autoFocus
            value={passphrase}
            onChange={setPassphrase}
            hint="본인인지 확인할게요."
          />
          <FormError>{error}</FormError>
          <PanelActions submitLabel="다음" busy={submitting} onCancel={cancel} />
        </form>
      )}
      {phase === "reauth" && (
        <ReauthPanel
          reason="2단계 인증을 켜려면 다시 로그인해 주세요."
          isGoogleAccount={isGoogleAccount}
          password={reauthPassword}
          onPasswordChange={setReauthPassword}
          onSubmitPassword={handleReauthPassword}
          onGoogle={() => void handleReauthGoogle()}
          busy={submitting}
          error={error}
          onCancel={cancel}
        />
      )}
      {phase === "setup" && setupMaterial && (
        <div className="space-y-4">
          <OtpQrCard uri={setupMaterial.uri} secret={setupMaterial.secret} />
          <form onSubmit={handleConfirm} className="space-y-4">
            {codeField}
            <FormError>{error}</FormError>
            <PanelActions submitLabel="켜기" busy={submitting} onCancel={cancel} />
          </form>
        </div>
      )}
      {phase === "disable" && (
        <form onSubmit={handleDisable} className="space-y-4">
          {codeField}
          <FormError>{error}</FormError>
          <PanelActions submitLabel="끄기" busy={submitting} onCancel={cancel} tone="danger" />
        </form>
      )}
    </SettingsRow>
  );
}

type ShamirPhase = "status" | "prove" | "reveal" | "disable";

/** Default split for codes issued here — the same as signup's (any 2 of 3). */
const DEFAULT_SHARES = { n: 3, k: 2 };

/**
 * Shamir setup/reissue/disable — passphrase and Shamir shares are co-equal
 * (contexts/SeedContext.tsx), so every action here can be proven with
 * EITHER credential. Setting up and reissuing are the same operation:
 * prove identity, then split the current seed into a fresh set of shares
 * that replaces whatever was configured before.
 */
function ShamirRow({
  config,
  stageSeedFromPassphrase,
  stageSeedFromShamirShares,
  discardStagedSeed,
  prepareShamir,
  confirmPendingShamir,
  disableShamir,
}: {
  config: ShamirConfig;
  stageSeedFromPassphrase: (passphrase: string) => Promise<void>;
  stageSeedFromShamirShares: (shares: Uint8Array[]) => Promise<void>;
  discardStagedSeed: () => void;
  prepareShamir: (n: number, k: number) => Promise<Uint8Array[]>;
  confirmPendingShamir: () => Promise<void>;
  disableShamir: () => Promise<void>;
}) {
  const [phase, setPhase] = useState<ShamirPhase>("status");
  const [proveMode, setProveMode] = useState<CredentialMode>("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [proofShares, setProofShares] = useState<string[]>(emptyShares(config));
  const [newN, setNewN] = useState(DEFAULT_SHARES.n);
  const [newK, setNewK] = useState(DEFAULT_SHARES.k);
  const [revealedShares, setRevealedShares] = useState<Uint8Array[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => () => discardStagedSeed(), [discardStagedSeed]);

  function cancel() {
    discardStagedSeed();
    setPhase("status");
    setError(null);
    setPassphrase("");
    setProofShares(emptyShares(config));
    setRevealedShares([]);
  }

  function startProve(mode: ShamirPhase) {
    setError(null);
    setMessage(null);
    setProveMode("passphrase");
    setProofShares(emptyShares(config));
    setPhase(mode);
  }

  async function stage() {
    if (proveMode === "passphrase") {
      await stageSeedFromPassphrase(passphrase);
      setPassphrase("");
    } else {
      await stageSeedFromShamirShares(proofShares.map((s) => textToRecoverySecret(s)));
    }
  }

  async function handleProveForSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (newK < 2 || newN < newK || newN > 10) {
      setError("만들 코드는 2~10개, 열 때 필요한 코드는 2개 이상이면서 만들 코드 수보다 많을 수 없어요.");
      return;
    }
    setSubmitting(true);
    try {
      await stage();
      const shares = await prepareShamir(newN, newK);
      setRevealedShares(shares);
      setPhase("reveal");
    } catch (err) {
      setError(credentialErrorMessage(err, "본인을 확인하지 못했어요."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmReveal() {
    setSubmitting(true);
    try {
      // Firestore is only written here, after the user has acknowledged
      // (via SecretReveal) that they saved the new shares. Leaving before
      // this point discards everything prepared.
      await confirmPendingShamir();
      setRevealedShares([]);
      setPhase("status");
      setMessage(config ? "새로 만들었어요" : "만들었어요");
    } catch (err) {
      console.error("confirmPendingShamir failed", err);
      // The likeliest cause is auto-lock firing while the codes were on
      // screen: locking discards the staged seed and the prepared shares
      // (contexts/SeedContext.tsx). Nothing was written to Firestore, so the
      // previous codes — if any — still work and the flow can be repeated.
      setError(
        "저장하지 못했어요. 자동 잠금이 걸렸을 수 있으니 처음부터 다시 해 주세요. 방금 보인 코드는 쓸 수 없고, 전에 만든 백업 코드는 그대로 쓸 수 있어요."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleProveForDisable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await stage();
      await disableShamir();
      setPhase("status");
      setMessage("껐어요");
    } catch (err) {
      setError(credentialErrorMessage(err, "본인을 확인하지 못했어요."));
    } finally {
      setSubmitting(false);
    }
  }

  const proof = (
    <CredentialProof
      mode={proveMode}
      onModeChange={setProveMode}
      shamirK={config?.k ?? null}
      passphrase={passphrase}
      onPassphraseChange={setPassphrase}
      shares={proofShares}
      onSharesChange={setProofShares}
    />
  );

  return (
    <SettingsRow
      label="백업 코드"
      description={
        config ? (
          <>
            {config.n}개 중 {config.k}개로 열 수 있어요
            {message && <span className="text-ink"> · {message}</span>}{" "}
            <MoreLink href={docHref("/docs/backup-codes")} />
          </>
        ) : (
          <>
            <span className="font-medium text-danger">아직 없어요</span> · 일기 암호를 잊으면 일기장을 열 수
            없어요
            {message && <span className="text-ink"> · {message}</span>}{" "}
            <MoreLink href={docHref("/docs/backup-codes")} />
          </>
        )
      }
      control={
        phase === "status" &&
        (config ? (
          <button type="button" onClick={() => startProve("prove")} className="btn-secondary btn-sm">
            재발급
          </button>
        ) : (
          <button type="button" onClick={() => startProve("prove")} className="btn-primary btn-sm">
            만들기
          </button>
        ))
      }
    >
      {phase === "status" && config && (
        <button
          type="button"
          onClick={() => startProve("disable")}
          className="btn-text min-h-10 px-0 text-sm text-ink-3"
        >
          백업 코드 해제
        </button>
      )}

      {phase === "prove" && (
        <form onSubmit={handleProveForSetup} className="space-y-4">
          {config && <p className="muted">새로 만들면 지금 가진 코드는 더 이상 쓸 수 없어요.</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="shamir-n" className="field-label">
                전체 장수
              </label>
              <input
                id="shamir-n"
                type="number"
                min={2}
                max={10}
                value={newN}
                onChange={(e) => setNewN(Number(e.target.value))}
                className="field"
              />
            </div>
            <div>
              <label htmlFor="shamir-k" className="field-label">
                필요한 장수
              </label>
              <input
                id="shamir-k"
                type="number"
                min={2}
                max={newN}
                value={newK}
                onChange={(e) => setNewK(Number(e.target.value))}
                className="field"
              />
            </div>
          </div>
          {proof}
          <FormError>{error}</FormError>
          <PanelActions submitLabel="다음" busy={submitting} onCancel={cancel} />
        </form>
      )}

      {phase === "reveal" && revealedShares.length > 0 && (
        <div className="space-y-3">
          <SecretReveal
            title="새 백업 코드"
            headingLevel={3}
            description={`${revealedShares.length}개 중 아무 ${newK}개만 있으면 일기 암호를 잊어도 일기장을 열 수 있어요. 서로 다른 곳에 나눠 두세요. 이 화면을 닫으면 다시 볼 수 없어요.`}
            confirmLabel={submitting ? "저장하는 중…" : "다 적었어요"}
            confirming={submitting}
            onConfirm={() => void handleConfirmReveal()}
          >
            <div className="space-y-4">
              {revealedShares.map((share, i) => (
                <SecretCard
                  key={i}
                  label={`코드 ${i + 1} / ${revealedShares.length}`}
                  text={recoverySecretToText(share)}
                  filename={`privatediary-backup-code-${i + 1}-of-${revealedShares.length}.txt`}
                />
              ))}
            </div>
          </SecretReveal>
          <FormError>{error}</FormError>
          <button type="button" onClick={cancel} className="btn-secondary w-full">
            저장하지 않고 닫기
          </button>
        </div>
      )}

      {phase === "disable" && config && (
        <form onSubmit={handleProveForDisable} className="space-y-4">
          <p className="muted">끄면 일기 암호를 잊었을 때 일기장을 열 방법이 없어져요.</p>
          {proof}
          <FormError>{error}</FormError>
          <PanelActions submitLabel="끄기" busy={submitting} onCancel={cancel} tone="danger" />
        </form>
      )}
    </SettingsRow>
  );
}

const DELETE_CONFIRM_PHRASE = "계정을 삭제합니다";

type DeleteAccountPhase = "status" | "credential" | "confirm" | "reauth";

/**
 * Permanently deletes the account and every entry in it.
 *
 * This used to be paired with a lighter "초기화" (full key reset) — removed
 * (see firestore.rules' isKeyRotationRequest() doc comment): it had no
 * cryptographic need to prove the OLD passphrase, so session-only proof
 * could silently destroy every entry. There's no safe shape of it, so this
 * is the only self-service option once both master credentials are gone —
 * and it requires one of them (below), so that case has no self-service
 * path left. An accepted, deliberate trade-off.
 *
 * TWO INDEPENDENT layers, deliberately stacked:
 *  1. CLIENT-SIDE, before anything is sent: prove one of the two co-equal
 *     master credentials (passphrase OR K backup codes), staged via
 *     stageSeedFromPassphrase/stageSeedFromShamirShares. Without it, any
 *     fresh-enough SESSION could destroy the account; login credentials
 *     and the diary passphrase are deliberately different secrets
 *     (ARCHITECTURE.md rule 3).
 *  2. SERVER-SIDE (functions' deleteAccount): a current OTP code when OTP
 *     is enabled, otherwise requireRecentAuth(). The server can't verify a
 *     passphrase at all (rule 1), so this is the only proof IT can check —
 *     surfaced here as the "reauth" phase, then retried automatically.
 */
function DeleteAccountRow({
  stageSeedFromPassphrase,
  stageSeedFromShamirShares,
  discardStagedSeed,
  decryptionMethods,
}: {
  stageSeedFromPassphrase: (passphrase: string) => Promise<void>;
  stageSeedFromShamirShares: (shares: Uint8Array[]) => Promise<void>;
  discardStagedSeed: () => void;
  decryptionMethods: DecryptionMethodsConfig | null;
}) {
  const { user } = useAuth();
  const { otpEnabled } = useOtp();
  const router = useRouter();
  const isGoogleAccount = useIsGoogleAccount();
  const shamirConfig = decryptionMethods?.shamir ?? null;

  const [phase, setPhase] = useState<DeleteAccountPhase>("status");
  const [credentialMode, setCredentialMode] = useState<CredentialMode>("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [shareInputs, setShareInputs] = useState<string[]>(emptyShares(shamirConfig));
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [code, setCode] = useState("");
  const [reauthPassword, setReauthPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // A seed staged by an abandoned attempt must not sit in memory.
  useEffect(() => () => discardStagedSeed(), [discardStagedSeed]);

  async function handleProveCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (credentialMode === "passphrase") {
        await stageSeedFromPassphrase(passphrase);
      } else {
        await stageSeedFromShamirShares(shareInputs.map((s) => textToRecoverySecret(s)));
      }
      // Only proving possession — deleteAccount needs no seed.
      discardStagedSeed();
      setPassphrase("");
      setPhase("confirm");
    } catch (err) {
      setError(credentialErrorMessage(err, "본인을 확인하지 못했어요."));
    } finally {
      setSubmitting(false);
    }
  }

  // Shared by the confirm form and the reauth retry so ReauthRequiredError
  // is handled in one place; the typed phrase and OTP code stay filled in.
  async function attemptDelete() {
    try {
      await deleteAccount(otpEnabled ? code : undefined);
      // The phone's copy of the account goes with it (Android app).
      if (user) await deleteBackup(user.uid).catch(() => {});
      // The auth user no longer exists server-side; signing out clears the
      // local session (and, via SeedContext, staged seed, keys and drafts).
      await signOut();
      router.replace("/");
    } catch (err) {
      if (err instanceof ReauthRequiredError) {
        setError(null);
        setPhase("reauth");
        return;
      }
      if (err instanceof IncorrectOtpCodeError) {
        setError("인증 앱의 숫자를 다시 확인해 주세요.");
      } else if (err instanceof OtpLockedOutError) {
        setError("여러 번 틀려서 잠시 막아 두었어요. 1분 뒤에 다시 시도해 주세요.");
      } else {
        console.error("deleteAccount failed", err);
        setError("계정을 삭제하지 못했어요. 다시 시도해 주세요.");
      }
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (confirmPhrase !== DELETE_CONFIRM_PHRASE) {
      setError(`“${DELETE_CONFIRM_PHRASE}”를 똑같이 입력해 주세요.`);
      return;
    }
    setSubmitting(true);
    await attemptDelete();
  }

  async function handleReauthPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setError(null);
    setSubmitting(true);
    try {
      await reauthenticateWithPassword(user, reauthPassword);
      setReauthPassword("");
      await attemptDelete();
    } catch (err) {
      setError(reauthErrorMessage(err));
      setSubmitting(false);
    }
  }

  async function handleReauthGoogle() {
    if (!user) return;
    setError(null);
    setSubmitting(true);
    try {
      await reauthenticateWithGoogle(user);
      await attemptDelete();
    } catch (err) {
      setError(reauthErrorMessage(err));
      setSubmitting(false);
    }
  }

  function cancel() {
    discardStagedSeed();
    setPhase("status");
    setCredentialMode("passphrase");
    setPassphrase("");
    setShareInputs(emptyShares(shamirConfig));
    setConfirmPhrase("");
    setCode("");
    setReauthPassword("");
    setError(null);
    setSubmitting(false);
  }

  return (
    <SettingsRow
      label="계정 삭제"
      tone="danger"
      description="모든 일기와 계정이 지워지고 되돌릴 수 없어요"
      control={
        phase === "status" && (
          <button type="button" onClick={() => setPhase("credential")} className="btn-danger-outline btn-sm">
            삭제
          </button>
        )
      }
    >
      {phase === "credential" && (
        <form onSubmit={handleProveCredential} className="space-y-4">
          <p className="muted">
            남기고 싶은 일기는 먼저{" "}
            <Link href="/entries" className="link">
              일기장
            </Link>
            에서 내보내 두세요. 계속하려면 본인인지 확인할게요.
          </p>
          <CredentialProof
            mode={credentialMode}
            onModeChange={setCredentialMode}
            shamirK={shamirConfig?.k ?? null}
            passphrase={passphrase}
            onPassphraseChange={setPassphrase}
            shares={shareInputs}
            onSharesChange={setShareInputs}
          />
          <FormError>{error}</FormError>
          <PanelActions submitLabel="다음" busy={submitting} onCancel={cancel} tone="danger" />
        </form>
      )}

      {phase === "reauth" && (
        <ReauthPanel
          reason="계정을 삭제하려면 다시 로그인해 주세요."
          isGoogleAccount={isGoogleAccount}
          password={reauthPassword}
          onPasswordChange={setReauthPassword}
          onSubmitPassword={handleReauthPassword}
          onGoogle={() => void handleReauthGoogle()}
          busy={submitting}
          error={error}
          onCancel={cancel}
          tone="danger"
        />
      )}

      {/* Credential already proven — this is the typed "are you sure" (and
          the OTP code the server itself separately requires). */}
      {phase === "confirm" && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <TextField
            label={`확인을 위해 “${DELETE_CONFIRM_PHRASE}”를 입력해 주세요`}
            autoFocus
            autoComplete="off"
            value={confirmPhrase}
            onChange={setConfirmPhrase}
            placeholder={DELETE_CONFIRM_PHRASE}
          />
          {otpEnabled && (
            <TextField
              label="인증 앱의 6자리 숫자"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={setCode}
              placeholder="123456"
            />
          )}
          <FormError>{error}</FormError>
          <PanelActions
            submitLabel="삭제하기"
            busyLabel="삭제하는 중…"
            busy={submitting}
            onCancel={cancel}
            tone="danger"
          />
        </form>
      )}
    </SettingsRow>
  );
}
