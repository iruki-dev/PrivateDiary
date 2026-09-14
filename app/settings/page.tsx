"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useOtp } from "@/contexts/OtpContext";
import { OtpGate } from "@/components/OtpGate";
import { useSeed } from "@/contexts/SeedContext";
import { usePreferences } from "@/contexts/PreferencesContext";
import { checkPassphraseStrength } from "@/lib/passphraseStrength";
import { PassphraseStrengthMeter } from "@/components/PassphraseStrengthMeter";
import { SecretReveal } from "@/components/SecretReveal";
import { SecretCard } from "@/components/SecretCard";
import { OtpQrCard } from "@/components/OtpQrCard";
import { LoadingScreen } from "@/components/LoadingState";
import { usePageTitle } from "@/hooks/usePageTitle";
import { AUTO_LOCK_CHOICES } from "@/lib/preferences";
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
import {
  InvalidShamirSharesError,
  WrongPassphraseError,
  recoverySecretToText,
  textToRecoverySecret,
  type DecryptionMethodsConfig,
} from "@/lib/crypto";

export default function SettingsPage() {
  const { status: authStatus } = useAuth();
  const {
    status: seedStatus,
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
  const router = useRouter();
  usePageTitle("설정");

  useEffect(() => {
    if (authStatus === "signed-in" && seedStatus === "not-issued") {
      router.replace("/signup");
    }
  }, [authStatus, seedStatus, router]);

  if (authStatus !== "signed-in" || seedStatus === "unknown" || seedStatus === "not-issued") {
    return <LoadingScreen />;
  }

  const shamirConfig = decryptionMethods?.shamir ?? null;

  return (
    <main className="flex flex-1 flex-col items-center gap-10 px-4 py-10 sm:gap-12 sm:px-6 sm:py-20">
      {/*
        Ungated, and the ONLY thing left that is: OtpSection manages OTP
        itself, so requiring OTP to reach the OTP settings would be
        circular — and each of its own actions already demands a valid
        code. Preferences used to sit out here too, back when they were
        display-only; `autoLockMinutes` made them security-relevant, so
        they moved inside the gate along with firestore.rules' matching
        change (see lib/preferences.ts).
      */}
      <OtpSection
        stageSeedFromPassphrase={stageSeedFromPassphrase}
        discardStagedSeed={discardStagedSeed}
      />

      {/*
        Everything below mutates a credential-bearing field on users/{uid}
        (wrappedSeed, publicKeys, decryptionMethods), which firestore.rules
        now releases only when otpSatisfied(). Without this gate those forms
        would render, accept input, and then fail with a bare
        permission-denied at submit time.

        The footer keeps the lost-the-OTP-device case recoverable: the
        Shamir share entry on /entries satisfies the same gate via
        verifyShamirOtpBypass (no TOTP code involved), and the claims it
        stamps are good for 12h across the whole session — so coming back
        here afterwards just works.
      */}
      <OtpGate
        footer={
          shamirConfig && (
            <Link href="/entries" className="block w-full text-center text-xs link">
              OTP 기기가 없다면 백업 코드로 잠금 해제 후 다시 시도
            </Link>
          )
        }
      >
        <div className="flex w-full flex-col items-center gap-10 sm:gap-12">
          <PrivateWritingSection />
          <SessionSection />
          <ChangePassphraseSection changePassphrase={changePassphrase} />
          {shamirConfig && (
            <ResetPassphraseSection
              config={shamirConfig}
              resetPassphraseWithShamirShares={resetPassphraseWithShamirShares}
            />
          )}

          <section className="w-full max-w-sm space-y-2">
        <h2 className="text-lg font-semibold">일기 복호화 방법</h2>
        <p className="muted">
          암호와 백업 코드는 서로 동등한 자격입니다. 둘 중 무엇을 갖고 있어도 일기를
          복호화하고, 암호를 재설정하고, 백업 코드를 새로 발급할 수 있습니다. 단, 어느
          한쪽을 안다고 해서 다른 쪽의 실제 값을 알아낼 수는 없습니다. 평소에는 암호를
          쓰고, 그마저 잃어버렸을 때를 위한 비상 수단이 백업 코드입니다.
        </p>
      </section>
          <ShamirSection
            config={shamirConfig}
            stageSeedFromPassphrase={stageSeedFromPassphrase}
            stageSeedFromShamirShares={stageSeedFromShamirShares}
            discardStagedSeed={discardStagedSeed}
            prepareShamir={prepareShamir}
            confirmPendingShamir={confirmPendingShamir}
            disableShamir={disableShamir}
          />

          <DeleteAccountSection
            stageSeedFromPassphrase={stageSeedFromPassphrase}
            stageSeedFromShamirShares={stageSeedFromShamirShares}
            discardStagedSeed={discardStagedSeed}
            decryptionMethods={decryptionMethods}
          />
        </div>
      </OtpGate>
    </main>
  );
}

/**
 * Toggles the /write textarea's blur-while-typing display. This never
 * touches the diary's actual encryption — it is a pure display layer
 * (ARCHITECTURE.md §3.9) — but it lives on the same `preferences` field as
 * auto-lock, and that field is now OTP-gated as a whole, so this renders
 * inside the gate with everything else. Styled like OtpSection's status
 * text + button rather than a boxed switch, for consistency with the rest
 * of this page.
 */
function PrivateWritingSection() {
  const { loading, privateWritingMode, privateWritingPeekAllowed, setPrivateWritingMode, setPrivateWritingPeekAllowed } =
    usePreferences();

  if (loading) {
    return null;
  }

  return (
    <section className="w-full max-w-sm space-y-4">
      <h2 className="text-lg font-semibold">프라이빗 작성 모드</h2>
      <p className="muted">
        켜두면 오늘의 일기를 쓰는 동안 글자를 흐리게 표시해, 화면을 옆에서 보더라도 내용을
        읽을 수 없게 합니다. 계정에 저장되어 로그인한 모든 기기에 동일하게 적용됩니다. 현재:{" "}
        <strong>{privateWritingMode ? "사용 중" : "사용 안 함"}</strong>
      </p>
      <button
        type="button"
        onClick={() => void setPrivateWritingMode(!privateWritingMode)}
        className={privateWritingMode ? "btn-danger-outline w-full" : "btn-primary w-full"}
      >
        {privateWritingMode ? "프라이빗 작성 모드 끄기" : "프라이빗 작성 모드 켜기"}
      </button>
      <p className="muted">
        일기 작성 화면에 누르고 있는 동안 잠시 확인할 수 있는 아이콘을 표시할지 정합니다.
        끄면 프라이빗 작성 모드 중에는 어떤 방법으로도 내용을 다시 확인할 수 없습니다. 현재:{" "}
        <strong>{privateWritingPeekAllowed ? "표시함" : "표시 안 함"}</strong>
      </p>
      <button
        type="button"
        onClick={() => void setPrivateWritingPeekAllowed(!privateWritingPeekAllowed)}
        className="btn-secondary w-full"
      >
        {privateWritingPeekAllowed ? "확인 아이콘 숨기기" : "확인 아이콘 보이기"}
      </button>
    </section>
  );
}

/**
 * Session and draft handling — the two preferences that are about
 * exposure rather than appearance.
 *
 * Both live in `users/{uid}.security` (lib/preferences.ts), a field
 * separate from the cosmetic `preferences` map specifically so it can be
 * gated like a credential-bearing field: firestore.rules'
 * credentialMutationAllowed() requires either a valid OTP session or —
 * for accounts without OTP — proof of an actual sign-in in the last few
 * minutes (isRecentAuth()). This section sits inside the OTP gate for the
 * OTP-enabled case; for the non-OTP case, a write here can still hit that
 * isRecentAuth() wall on a session that's been open a while, surfaced
 * below as ReauthRequiredError rather than a bare failure.
 */
function SessionSection() {
  const { loading, autoLockMinutes, draftAutosave, setAutoLockMinutes, setDraftAutosave } =
    usePreferences();
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return null;
  }

  function reauthMessage(err: unknown, fallback: string): string {
    return err instanceof ReauthRequiredError
      ? "보안 설정을 바꾸려면 최근에 로그인한 상태여야 합니다. 로그아웃 후 다시 로그인해 시도해주세요."
      : fallback;
  }

  async function handleAutoLockChange(minutes: number) {
    setError(null);
    try {
      await setAutoLockMinutes(minutes);
    } catch (err) {
      setError(reauthMessage(err, "자동 잠금 설정을 저장하지 못했습니다."));
    }
  }

  async function toggleDraftAutosave() {
    setError(null);
    const next = !draftAutosave;
    try {
      await setDraftAutosave(next);
      // Turning it off has to remove what is already stored on this
      // device, otherwise the setting reads as "no plaintext here" while
      // yesterday's draft is still sitting in localStorage. Done only
      // after the write succeeds — a failed write must not clear a draft
      // the setting change never actually took effect for.
      if (!next) clearAllDrafts();
    } catch (err) {
      setError(reauthMessage(err, "임시 저장 설정을 저장하지 못했습니다."));
    }
  }

  return (
    <section className="w-full max-w-sm space-y-4">
      <h2 className="text-lg font-semibold">세션과 임시 저장</h2>

      <div className="space-y-2">
        <label htmlFor="auto-lock-minutes" className="block text-sm font-medium">
          자동 잠금
        </label>
        <p className="muted">
          잠금을 해제한 뒤 이만큼 아무 조작이 없으면 메모리에서 키를 지우고 다시 잠급니다. 일기를
          쓰는 것은 잠긴 상태에서도 그대로 됩니다.
        </p>
        <select
          id="auto-lock-minutes"
          value={autoLockMinutes}
          onChange={(event) => void handleAutoLockChange(Number(event.target.value))}
          className="field"
        >
          {AUTO_LOCK_CHOICES.map((choice) => (
            <option key={choice.minutes} value={choice.minutes}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <p className="muted">
          작성 중인 일기를 기기에 임시 저장해두면, 탭이 닫히거나 브라우저가 꺼져도 글이 남습니다.
          다만 임시 저장본은 <strong>암호화되지 않은 상태로 그 기기에 저장</strong>되므로 기본값은
          꺼짐입니다. 일기를 저장하거나 로그아웃하면 즉시 지워집니다. 현재:{" "}
          <strong>{draftAutosave ? "사용 중" : "사용 안 함"}</strong>
        </p>
        <button
          type="button"
          onClick={() => void toggleDraftAutosave()}
          className={draftAutosave ? "btn-danger-outline w-full" : "btn-secondary w-full"}
        >
          {draftAutosave ? "임시 저장 끄기" : "임시 저장 켜기"}
        </button>
      </div>

      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </section>
  );
}

function ChangePassphraseSection({
  changePassphrase,
}: {
  changePassphrase: (oldPassphrase: string, newPassphrase: string) => Promise<void>;
}) {
  const [oldPassphrase, setOldPassphrase] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassphrase !== confirmPassphrase) {
      setError("새 암호 확인이 일치하지 않습니다.");
      return;
    }
    if (!checkPassphraseStrength(newPassphrase).isStrongEnough) {
      setError("새 암호가 너무 약합니다.");
      return;
    }

    setSubmitting(true);
    try {
      await changePassphrase(oldPassphrase, newPassphrase);
      setSuccess(true);
      setOldPassphrase("");
      setNewPassphrase("");
      setConfirmPassphrase("");
    } catch (err) {
      setError(
        err instanceof WrongPassphraseError
          ? "기존 암호가 올바르지 않습니다."
          : "암호를 변경하지 못했습니다."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="w-full max-w-sm space-y-4">
      <h2 className="text-lg font-semibold">암호 변경</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="password"
          required
          autoComplete="current-password"
          aria-label="기존 암호"
          value={oldPassphrase}
          onChange={(e) => setOldPassphrase(e.target.value)}
          placeholder="기존 암호"
          className="field"
        />
        <input
          type="password"
          required
          autoComplete="new-password"
          aria-label="새 암호"
          value={newPassphrase}
          onChange={(e) => setNewPassphrase(e.target.value)}
          placeholder="새 암호"
          className="field"
        />
        <PassphraseStrengthMeter passphrase={newPassphrase} />
        <input
          type="password"
          required
          autoComplete="new-password"
          aria-label="새 암호 확인"
          value={confirmPassphrase}
          onChange={(e) => setConfirmPassphrase(e.target.value)}
          placeholder="새 암호 확인"
          className="field"
        />
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="success-text">
            암호가 변경되었습니다.
          </p>
        )}
        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? "변경 중..." : "변경하기"}
        </button>
      </form>
    </section>
  );
}

/**
 * Passphrase reset via Shamir shares ("백업 코드" in the UI) — for when the
 * passphrase itself is forgotten, not just being routinely changed. No old
 * passphrase is needed; K shares prove the same underlying master
 * credential (contexts/SeedContext.tsx's doc comment). Only shown once
 * Shamir is configured.
 */
function ResetPassphraseSection({
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
      setError("새 암호 확인이 일치하지 않습니다.");
      return;
    }
    if (!checkPassphraseStrength(newPassphrase).isStrongEnough) {
      setError("새 암호가 너무 약합니다.");
      return;
    }

    setSubmitting(true);
    try {
      await resetPassphraseWithShamirShares(
        shareInputs.map((s) => textToRecoverySecret(s)),
        newPassphrase
      );
      setSuccess(true);
      setOpen(false);
      setShareInputs(Array(config.k).fill(""));
      setNewPassphrase("");
      setConfirmPassphrase("");
    } catch (err) {
      if (!(err instanceof InvalidShamirSharesError)) console.error("resetPassphraseWithShamirShares failed", err);
      setError(
        err instanceof InvalidShamirSharesError
          ? "백업 코드가 올바른 시드로 복원되지 않습니다."
          : "재설정하지 못했습니다."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="w-full max-w-sm space-y-4 card">
      <div>
        <h2 className="text-lg font-semibold">암호를 잊으셨나요?</h2>
        <p className="mt-1 muted">
          백업 코드 {config.k}개를 모으면 기존 일기를 그대로 유지한 채 새 암호를 설정할
          수 있습니다.
        </p>
      </div>
      {success && (
        <p role="status" className="success-text">
          암호가 재설정되었습니다.
        </p>
      )}
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="btn-secondary w-full">
          백업 코드로 재설정
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
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
          <input
            type="password"
            required
            autoComplete="new-password"
            aria-label="새 암호"
            value={newPassphrase}
            onChange={(e) => setNewPassphrase(e.target.value)}
            placeholder="새 암호"
            className="field"
          />
          <PassphraseStrengthMeter passphrase={newPassphrase} />
          <input
            type="password"
            required
            autoComplete="new-password"
            aria-label="새 암호 확인"
            value={confirmPassphrase}
            onChange={(e) => setConfirmPassphrase(e.target.value)}
            placeholder="새 암호 확인"
            className="field"
          />
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? "재설정 중..." : "재설정하기"}
          </button>
          <button type="button" onClick={cancel} className="w-full text-center text-xs link">
            취소
          </button>
        </form>
      )}
    </section>
  );
}

/**
 * OTP (TOTP authenticator app) as an access gate — see
 * functions/src/index.ts and contexts/OtpContext.tsx for why this is a
 * server-verified gate rather than a cryptographic factor combined into
 * the diary's encryption.
 *
 * Enabling asks for the passphrase first, matching the "prove a master
 * credential before changing account security settings" rule the Shamir
 * setup/disable flows follow — but that check alone is NOT what actually
 * protects a first-time enrollment: it's a local AES-GCM unwrap the server
 * never sees (lib/crypto/passphrase.ts's unwrapSeed doc comment — this
 * codebase has no server-side "is this passphrase correct" check anywhere,
 * by design). security-patch-v2: the server-verifiable gate is
 * requireRecentAuth() in functions/src/index.ts, which the passphrase step
 * here can't satisfy on its own. When startSetup() reports that (via
 * ReauthRequiredError), this drops into a "reauth" phase that asks the
 * user to prove the LOGIN credential instead — a password re-entry or a
 * fresh Google popup — which the server CAN verify (via the ID token's
 * auth_time claim), then retries. Disabling requires a currently-valid code.
 */
type OtpPhase = "status" | "confirm-passphrase" | "reauth" | "setup" | "disable";

function OtpSection({
  stageSeedFromPassphrase,
  discardStagedSeed,
}: {
  stageSeedFromPassphrase: (passphrase: string) => Promise<void>;
  discardStagedSeed: () => void;
}) {
  const { user } = useAuth();
  const { loading, otpEnabled, startSetup, confirmSetup, disable } = useOtp();
  const [phase, setPhase] = useState<OtpPhase>("status");
  const [passphrase, setPassphrase] = useState("");
  const [reauthPassword, setReauthPassword] = useState("");
  const [setupMaterial, setSetupMaterial] = useState<OtpSetupMaterial | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Google-signed-in users have no login password to re-enter — see
  // lib/firebase/auth.ts's reauthenticateWithGoogle doc comment.
  const isGoogleAccount = user?.providerData.some((p) => p.providerId === "google.com") ?? false;

  function otpErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof IncorrectOtpCodeError) return "코드가 올바르지 않습니다.";
    if (err instanceof OtpLockedOutError) return "시도 횟수를 초과했습니다. 잠시 후 다시 시도하세요.";
    return fallback;
  }

  function friendlyReauthError(err: unknown): string {
    const code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "";
    switch (code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
        return "비밀번호가 올바르지 않습니다.";
      case "auth/popup-closed-by-user":
      case "auth/cancelled-popup-request":
        return "다시 로그인이 취소되었습니다.";
      default:
        return "다시 로그인하지 못했습니다. 다시 시도해주세요.";
    }
  }

  // Shared by both entry points into OTP setup (the passphrase step below,
  // and the reauth retry) so ReauthRequiredError is handled in exactly one
  // place: attempt startSetup(), and if the server says this session's
  // sign-in isn't recent enough, drop into the reauth phase instead of
  // surfacing it as a generic failure.
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
      // Only proving identity here — OTP setup doesn't need the seed
      // itself, unlike Shamir setup/reissue, so it's discarded right away
      // rather than left staged.
      await stageSeedFromPassphrase(passphrase);
      discardStagedSeed();
      setPassphrase("");
      await beginOtpSetup();
    } catch (err) {
      setError(err instanceof WrongPassphraseError ? "암호가 올바르지 않습니다." : "OTP 설정을 시작하지 못했습니다.");
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
      setError(friendlyReauthError(err));
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
      setError(friendlyReauthError(err));
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
      setMessage("OTP가 활성화되었습니다.");
    } catch (err) {
      setError(otpErrorMessage(err, "확인하지 못했습니다."));
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
      setMessage("OTP가 비활성화되었습니다.");
    } catch (err) {
      setError(otpErrorMessage(err, "비활성화하지 못했습니다."));
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

  if (loading) {
    return null;
  }

  if (phase === "confirm-passphrase") {
    return (
      <section className="w-full max-w-sm space-y-4">
        <h2 className="text-lg font-semibold">OTP 활성화</h2>
        <form onSubmit={handleConfirmPassphrase} className="space-y-3">
          <p className="muted">본인 확인을 위해 암호를 입력하세요.</p>
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
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? "확인 중..." : "다음"}
          </button>
          <button type="button" onClick={cancel} className="w-full text-center text-xs link">
            취소
          </button>
        </form>
      </section>
    );
  }

  if (phase === "reauth") {
    return (
      <section className="w-full max-w-sm space-y-4">
        <h2 className="text-lg font-semibold">다시 로그인해주세요</h2>
        <p className="muted">
          보안을 위해 OTP를 새로 등록하려면 로그인을 한 번 더 확인해야 합니다.
        </p>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {isGoogleAccount ? (
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleReauthGoogle()}
            className="btn-primary w-full"
          >
            {submitting ? "확인 중..." : "Google로 다시 로그인"}
          </button>
        ) : (
          <form onSubmit={handleReauthPassword} className="space-y-3">
            <input
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              aria-label="로그인 비밀번호"
              value={reauthPassword}
              onChange={(e) => setReauthPassword(e.target.value)}
              placeholder="로그인 비밀번호"
              className="field"
            />
            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting ? "확인 중..." : "다시 로그인"}
            </button>
          </form>
        )}
        <button type="button" onClick={cancel} className="w-full text-center text-xs link">
          취소
        </button>
      </section>
    );
  }

  if (phase === "setup" && setupMaterial) {
    return (
      <section className="w-full max-w-sm space-y-4">
        <h2 className="text-lg font-semibold">OTP 활성화</h2>
        <OtpQrCard uri={setupMaterial.uri} secret={setupMaterial.secret} />
        <form onSubmit={handleConfirm} className="space-y-3">
          <p className="muted">등록 후 앱에 표시된 코드를 입력해 확인하세요.</p>
          <input
            type="text"
            required
            autoFocus
            inputMode="numeric"
            aria-label="OTP 코드"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className="field-code"
          />
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? "확인 중..." : "활성화 확인"}
          </button>
          <button type="button" onClick={cancel} className="w-full text-center text-xs link">
            취소
          </button>
        </form>
      </section>
    );
  }

  if (phase === "disable") {
    return (
      <section className="w-full max-w-sm space-y-4">
        <h2 className="text-lg font-semibold">OTP 비활성화</h2>
        <form onSubmit={handleDisable} className="space-y-3">
          <p className="muted">본인 확인을 위해 현재 인증 앱의 코드를 입력하세요.</p>
          <input
            type="text"
            required
            autoFocus
            inputMode="numeric"
            aria-label="OTP 코드"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className="field-code"
          />
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <button type="submit" disabled={submitting} className="btn-danger w-full">
            {submitting ? "확인 중..." : "비활성화"}
          </button>
          <button type="button" onClick={cancel} className="w-full text-center text-xs link">
            취소
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="w-full max-w-sm space-y-4">
      <h2 className="text-lg font-semibold">OTP 인증</h2>
      <p className="muted">
        구글 OTP 같은 인증 앱의 코드가 맞아야 저장된 일기를 불러올 수 있도록 하는 추가 접근
        게이트입니다. 암호화 자체와는 별개로 서버가 코드를 검증합니다. 현재:{" "}
        <strong>{otpEnabled ? "사용 중" : "사용 안 함"}</strong>
      </p>
      {message && (
        <p role="status" className="success-text">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {otpEnabled ? (
        <button
          type="button"
          onClick={() => setPhase("disable")}
          className="btn-danger-outline w-full"
        >
          OTP 비활성화
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setMessage(null);
            setPhase("confirm-passphrase");
          }}
          className="btn-primary w-full"
        >
          OTP 활성화
        </button>
      )}
    </section>
  );
}

type ShamirPhase = "status" | "prove" | "reveal" | "disable";
type ProveMode = "passphrase" | "shamir";

/**
 * Shamir setup/reissue/disable — passphrase and Shamir shares are co-equal
 * (contexts/SeedContext.tsx's doc comment), so every action here can be
 * proven with EITHER credential. Setting up and reissuing are the same
 * operation: proving identity, then splitting the current seed into a fresh
 * set of shares that overwrites whatever was configured before.
 */
function ShamirSection({
  config,
  stageSeedFromPassphrase,
  stageSeedFromShamirShares,
  discardStagedSeed,
  prepareShamir,
  confirmPendingShamir,
  disableShamir,
}: {
  config: { n: number; k: number } | null;
  stageSeedFromPassphrase: (passphrase: string) => Promise<void>;
  stageSeedFromShamirShares: (shares: Uint8Array[]) => Promise<void>;
  discardStagedSeed: () => void;
  prepareShamir: (n: number, k: number) => Promise<Uint8Array[]>;
  confirmPendingShamir: () => Promise<void>;
  disableShamir: () => Promise<void>;
}) {
  const [phase, setPhase] = useState<ShamirPhase>("status");
  const [proveMode, setProveMode] = useState<ProveMode>("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [proofShares, setProofShares] = useState<string[]>(config ? Array(config.k).fill("") : []);
  const [newN, setNewN] = useState(5);
  const [newK, setNewK] = useState(3);
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
    setProofShares(config ? Array(config.k).fill("") : []);
    setRevealedShares([]);
  }

  function startProve(mode: ShamirPhase) {
    setError(null);
    setProveMode("passphrase");
    setProofShares(config ? Array(config.k).fill("") : []);
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

  function proveErrorMessage(err: unknown): string {
    if (err instanceof WrongPassphraseError) return "암호가 올바르지 않습니다.";
    if (err instanceof InvalidShamirSharesError) return "백업 코드가 올바른 시드로 복원되지 않습니다.";
    return "본인 확인에 실패했습니다.";
  }

  async function handleProveForSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (newK < 2 || newN < newK || newN > 10) {
      setError("전체 코드 수(N)는 2~10, 필요한 코드 수(K)는 2 이상이면서 N 이하여야 합니다.");
      return;
    }
    setSubmitting(true);
    try {
      await stage();
      const shares = await prepareShamir(newN, newK);
      setRevealedShares(shares);
      setPhase("reveal");
    } catch (err) {
      setError(proveErrorMessage(err));
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
      setMessage(config ? "백업 코드가 재발급되었습니다." : "백업 코드가 활성화되었습니다.");
    } catch (err) {
      console.error("confirmPendingShamir failed", err);
      // The likeliest cause is auto-lock firing while the codes were on
      // screen being written down: locking discards the staged seed and
      // the prepared shares with it (contexts/SeedContext.tsx). Nothing
      // was written to Firestore, so the previous codes — if any — still
      // work and the whole flow can simply be repeated.
      setError(
        "저장하지 못했습니다. 자동 잠금이 걸렸을 수 있습니다 — 처음부터 다시 시도해주세요. " +
          "방금 표시된 코드는 저장되지 않았으므로 사용할 수 없고, 이전 백업 코드가 있다면 그대로 유효합니다."
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
      setMessage("백업 코드가 비활성화되었습니다.");
    } catch (err) {
      setError(proveErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const proveModeToggle = (
    <div className="flex gap-2" role="radiogroup" aria-label="본인 확인 방법">
      <button
        type="button"
        role="radio"
        aria-checked={proveMode === "passphrase"}
        onClick={() => setProveMode("passphrase")}
        className={`btn-sm flex-1 ${proveMode === "passphrase" ? "btn-primary" : "btn-secondary"}`}
      >
        암호로 인증
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={proveMode === "shamir"}
        disabled={!config}
        onClick={() => setProveMode("shamir")}
        className={`btn-sm flex-1 ${proveMode === "shamir" ? "btn-primary" : "btn-secondary"}`}
      >
        기존 백업 코드로 인증
      </button>
    </div>
  );

  if (phase === "reveal" && revealedShares.length > 0) {
    return (
      <section className="w-full max-w-lg space-y-3">
        <SecretReveal
          title="백업 코드"
          description={`총 ${revealedShares.length}개의 코드 중 ${newK}개를 모으면 시드를 복원할 수 있습니다. 코드 하나만으로는 아무 의미가 없으니, 각 코드를 서로 다른 안전한 곳에 나눠 보관하세요. 이전에 발급된 코드가 있었다면 이제 무효가 됩니다. 이 화면은 다시 표시되지 않습니다.`}
          confirmLabel={submitting ? "저장 중..." : "완료 — 이 코드들을 활성화합니다"}
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
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button type="button" onClick={cancel} className="w-full text-center text-xs link">
          취소 (활성화하지 않음)
        </button>
      </section>
    );
  }

  if (phase === "prove") {
    return (
      <section className="w-full max-w-sm space-y-4">
        <h2 className="text-lg font-semibold">{config ? "백업 코드 재발급" : "백업 코드 활성화"}</h2>
        <form onSubmit={handleProveForSetup} className="space-y-3">
          {proveModeToggle}
          {proveMode === "passphrase" ? (
            <input
              type="password"
              required
              autoComplete="current-password"
              aria-label="암호"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="암호"
              className="field"
            />
          ) : (
            <div className="space-y-2">
              {proofShares.map((value, i) => (
                <input
                  key={i}
                  type="text"
                  required
                  aria-label={`백업 코드 ${i + 1}`}
                  value={value}
                  onChange={(e) =>
                    setProofShares((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
                  }
                  placeholder={`코드 ${i + 1}`}
                  className="field-mono"
                />
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <label className="flex-1 text-xs">
              전체(N)
              <input
                type="number"
                min={2}
                max={10}
                value={newN}
                onChange={(e) => setNewN(Number(e.target.value))}
                className="field mt-1"
              />
            </label>
            <label className="flex-1 text-xs">
              필요(K)
              <input
                type="number"
                min={2}
                max={newN}
                value={newK}
                onChange={(e) => setNewK(Number(e.target.value))}
                className="field mt-1"
              />
            </label>
          </div>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? "확인 중..." : "다음"}
          </button>
          <button type="button" onClick={cancel} className="w-full text-center text-xs link">
            취소
          </button>
        </form>
      </section>
    );
  }

  if (phase === "disable" && config) {
    return (
      <section className="w-full max-w-sm space-y-4">
        <h2 className="text-lg font-semibold">백업 코드 비활성화</h2>
        <form onSubmit={handleProveForDisable} className="space-y-3">
          {proveModeToggle}
          {proveMode === "passphrase" ? (
            <input
              type="password"
              required
              autoComplete="current-password"
              aria-label="암호"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="암호"
              className="field"
            />
          ) : (
            <div className="space-y-2">
              {proofShares.map((value, i) => (
                <input
                  key={i}
                  type="text"
                  required
                  aria-label={`백업 코드 ${i + 1}`}
                  value={value}
                  onChange={(e) =>
                    setProofShares((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
                  }
                  placeholder={`코드 ${i + 1}`}
                  className="field-mono"
                />
              ))}
            </div>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <button type="submit" disabled={submitting} className="btn-danger w-full">
            {submitting ? "확인 중..." : "비활성화"}
          </button>
          <button type="button" onClick={cancel} className="w-full text-center text-xs link">
            취소
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="w-full max-w-sm space-y-3 card">
      <p className="text-sm font-medium">
        백업 코드:{" "}
        <strong>{config ? `사용 중 (${config.n}개 중 ${config.k}개 필요)` : "사용 안 함"}</strong>
      </p>
      <p className="text-xs text-zinc-500">
        N개의 코드로 나눠, K개를 모아야 잠금 해제. 코드 하나만 유출되면 무의미해 더 안전합니다.
      </p>
      {message && (
        <p role="status" className="success-text">
          {message}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => startProve("prove")}
          className="btn-primary btn-sm flex-1"
        >
          {config ? "재발급" : "활성화"}
        </button>
        {config && (
          <button
            type="button"
            onClick={() => startProve("disable")}
            className="btn-danger-outline btn-sm flex-1"
          >
            비활성화
          </button>
        )}
      </div>
    </section>
  );
}

const DELETE_CONFIRM_PHRASE = "계정을 삭제합니다";

type DeleteAccountPhase = "credential" | "confirm" | "reauth";
type DeleteCredentialMode = "passphrase" | "shamir";

/**
 * Permanently deletes the account and every entry in it.
 *
 * This used to be paired with a lighter "초기화" (full key reset) option
 * above it — issue a brand-new seed, leave the old ciphertext stored but
 * permanently unreadable, keep the account itself alive. That feature was
 * removed entirely (see firestore.rules' isKeyRotationRequest() doc
 * comment for the full reasoning): unlike every other credential-mutating
 * write in this file, it had no cryptographic requirement to prove the
 * OLD passphrase, which made it reachable by session-only proof alone —
 * silently destroying every existing entry for the real owner. There is
 * no safe shape of that feature (requiring the passphrase defeats its own
 * "I forgot the passphrase" purpose), so account deletion below is now the
 * only self-service option once both master credentials are gone — and
 * this function itself requires proving one of them (see below), so that
 * scenario has genuinely no self-service path left. That is an accepted,
 * deliberate trade-off, not an oversight.
 *
 * TWO INDEPENDENT layers gate this, deliberately stacked rather than
 * either replacing the other:
 *
 *  1. CLIENT-SIDE, before anything is sent to the server: the same "prove
 *     one of the two co-equal master credentials" rule that gates every
 *     other account-security change in this file (OtpSection, ShamirSection,
 *     ChangePassphraseSection) — passphrase OR K backup codes, staged via
 *     stageSeedFromPassphrase/stageSeedFromShamirShares exactly like those.
 *     This closes a real gap the first version of this function had: it
 *     only asked for the login-level proof below, which meant anyone
 *     holding a valid, sufficiently fresh SESSION — not necessarily the
 *     diary's actual master credential — could destroy the whole account.
 *     Login credentials and the diary passphrase are deliberately
 *     different secrets in this design (ARCHITECTURE.md rule 3); gating
 *     the single most destructive, least reversible action behind only
 *     the weaker of the two didn't match its severity.
 *  2. SERVER-SIDE (functions/src/index.ts's deleteAccount): a current OTP
 *     code when OTP is enabled, or requireRecentAuth() otherwise — proof
 *     of an actual sign-in in the last few minutes. This layer can't be
 *     replaced by the client-side one above: the server has no way to
 *     verify a passphrase or Shamir shares at all (rule 1 — it never sees
 *     them), so this remains the only proof the SERVER itself can check
 *     before executing the deletion. Surfaced here as the "reauth" phase
 *     (password re-entry or a fresh Google popup, then automatic retry)
 *     when it's the piece still missing.
 *
 * Passphrase and backup codes stay genuinely equivalent here, same as
 * everywhere else in this app (ARCHITECTURE.md §3.7) — losing the
 * passphrase alone never locks someone out of deleting their own account,
 * as long as they still hold K backup codes.
 */
function DeleteAccountSection({
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
  const shamirConfig = decryptionMethods?.shamir ?? null;

  const [phase, setPhase] = useState<DeleteAccountPhase>("credential");
  const [open, setOpen] = useState(false);
  const [credentialMode, setCredentialMode] = useState<DeleteCredentialMode>("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [shareInputs, setShareInputs] = useState<string[]>(
    shamirConfig ? Array(shamirConfig.k).fill("") : []
  );
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [code, setCode] = useState("");
  const [reauthPassword, setReauthPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // A staged seed left behind by an abandoned attempt (navigated away
  // mid-flow) must not sit in memory indefinitely — same discipline
  // ShamirSection follows.
  useEffect(() => () => discardStagedSeed(), [discardStagedSeed]);

  // Google-signed-in users have no login password to re-enter — see
  // lib/firebase/auth.ts's reauthenticateWithGoogle doc comment.
  const isGoogleAccount = user?.providerData.some((p) => p.providerId === "google.com") ?? false;

  function credentialErrorMessage(err: unknown): string {
    if (err instanceof WrongPassphraseError) return "암호가 올바르지 않습니다.";
    if (err instanceof InvalidShamirSharesError) return "백업 코드가 올바른 시드로 복원되지 않습니다.";
    return "본인 확인에 실패했습니다.";
  }

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
      // Only proving possession here — deleteAccount doesn't need the seed
      // itself (destruction needs no read access; see the module doc
      // above), so nothing more is done with it once proven.
      discardStagedSeed();
      setPassphrase("");
      setPhase("confirm");
    } catch (err) {
      setError(credentialErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  // Shared by the confirm form and the reauth retry (mirrors OtpSection's
  // beginOtpSetup) so ReauthRequiredError is handled in exactly one place:
  // attempt deleteAccount(), and if the server says this session's sign-in
  // isn't recent enough, drop into the reauth phase instead of surfacing a
  // generic failure — the confirm phrase and OTP code the user already
  // typed stay filled in for the retry.
  async function attemptDelete() {
    try {
      await deleteAccount(otpEnabled ? code : undefined);
      // The auth user no longer exists server-side; signing out clears the
      // now-void local session (and, via SeedContext, any staged seed,
      // derived keys and locally stored drafts) before navigating away.
      await signOut();
      router.replace("/");
    } catch (err) {
      if (err instanceof ReauthRequiredError) {
        setError(null);
        setPhase("reauth");
        return;
      }
      if (err instanceof IncorrectOtpCodeError) {
        setError("OTP 코드가 올바르지 않습니다.");
      } else if (err instanceof OtpLockedOutError) {
        setError("시도 횟수를 초과했습니다. 1분 후 다시 시도하세요.");
      } else {
        console.error("deleteAccount failed", err);
        setError("계정을 삭제하지 못했습니다. 다시 시도해주세요.");
      }
      setSubmitting(false);
    }
  }

  function friendlyReauthError(err: unknown): string {
    const code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "";
    switch (code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
        return "비밀번호가 올바르지 않습니다.";
      case "auth/popup-closed-by-user":
      case "auth/cancelled-popup-request":
        return "다시 로그인이 취소되었습니다.";
      default:
        return "다시 로그인하지 못했습니다. 다시 시도해주세요.";
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (confirmPhrase !== DELETE_CONFIRM_PHRASE) {
      setError(`확인 문구를 정확히 입력해주세요: "${DELETE_CONFIRM_PHRASE}"`);
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
      setError(friendlyReauthError(err));
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
      setError(friendlyReauthError(err));
      setSubmitting(false);
    }
  }

  function cancel() {
    discardStagedSeed();
    setOpen(false);
    setPhase("credential");
    setCredentialMode("passphrase");
    setPassphrase("");
    setShareInputs(shamirConfig ? Array(shamirConfig.k).fill("") : []);
    setConfirmPhrase("");
    setCode("");
    setReauthPassword("");
    setError(null);
    setSubmitting(false);
  }

  if (phase === "credential") {
    return (
      <section className="w-full max-w-sm space-y-4 card-danger">
        <div>
          <h2 className="text-lg font-semibold text-red-700 dark:text-red-500">계정 삭제</h2>
          <p className="mt-2 muted">
            작성한 모든 일기와 계정 자체를 서버에서{" "}
            <strong>완전히, 되돌릴 수 없이</strong> 삭제합니다.
          </p>
          <p className="mt-2 muted">
            남기고 싶은 일기가 있다면 먼저{" "}
            <Link href="/entries" className="link">
              지난 일기
            </Link>{" "}
            화면에서 잠금을 해제하고 내보내두세요. 삭제 후에는 어떤 방법으로도 되살릴 수 없습니다.
          </p>
        </div>

        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className="btn-danger-outline w-full">
            계정 삭제 시작
          </button>
        ) : (
          <form onSubmit={handleProveCredential} className="space-y-3">
            <p className="muted">
              계속하려면 암호 또는 백업 코드로 본인임을 증명하세요.
            </p>
            <div className="flex gap-2" role="radiogroup" aria-label="본인 확인 방법">
              <button
                type="button"
                role="radio"
                aria-checked={credentialMode === "passphrase"}
                onClick={() => setCredentialMode("passphrase")}
                className={`btn-sm flex-1 ${credentialMode === "passphrase" ? "btn-primary" : "btn-secondary"}`}
              >
                암호로 인증
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={credentialMode === "shamir"}
                disabled={!shamirConfig}
                onClick={() => setCredentialMode("shamir")}
                className={`btn-sm flex-1 ${credentialMode === "shamir" ? "btn-primary" : "btn-secondary"}`}
              >
                백업 코드로 인증
              </button>
            </div>
            {credentialMode === "passphrase" ? (
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
            ) : (
              shamirConfig && (
                <div className="space-y-2">
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
                </div>
              )
            )}
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <button type="submit" disabled={submitting} className="btn-danger w-full">
              {submitting ? "확인 중..." : "다음"}
            </button>
            <button type="button" onClick={cancel} className="w-full text-center text-xs link">
              취소
            </button>
          </form>
        )}
      </section>
    );
  }

  if (phase === "reauth") {
    return (
      <section className="w-full max-w-sm space-y-4 card-danger">
        <h2 className="text-lg font-semibold text-red-700 dark:text-red-500">다시 로그인해주세요</h2>
        <p className="muted">
          계정을 삭제하려면 로그인을 한 번 더 확인해야 합니다. 탈취된 세션만으로는 계정을 지울 수
          없도록 하는 보호 장치입니다.
        </p>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {isGoogleAccount ? (
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleReauthGoogle()}
            className="btn-danger w-full"
          >
            {submitting ? "확인 중..." : "Google로 다시 로그인 후 삭제"}
          </button>
        ) : (
          <form onSubmit={handleReauthPassword} className="space-y-3">
            <input
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              aria-label="로그인 비밀번호"
              value={reauthPassword}
              onChange={(e) => setReauthPassword(e.target.value)}
              placeholder="로그인 비밀번호"
              className="field"
            />
            <button type="submit" disabled={submitting} className="btn-danger w-full">
              {submitting ? "확인 중..." : "다시 로그인 후 삭제"}
            </button>
          </form>
        )}
        <button type="button" onClick={cancel} className="w-full text-center text-xs link">
          취소
        </button>
      </section>
    );
  }

  // phase === "confirm": credential already proven above — this is only
  // the typed "are you sure" confirmation (and the OTP code the server
  // itself separately requires).
  return (
    <section className="w-full max-w-sm space-y-4 card-danger">
      <h2 className="text-lg font-semibold text-red-700 dark:text-red-500">계정 삭제</h2>
      <p className="muted">본인 확인이 끝났습니다. 계속하려면 아래에 확인 문구를 입력하세요.</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="muted">
          계속하려면 아래에 <code className="font-mono">{DELETE_CONFIRM_PHRASE}</code>를
          입력하세요.
        </p>
        <input
          type="text"
          required
          autoFocus
          aria-label="확인 문구"
          value={confirmPhrase}
          onChange={(e) => setConfirmPhrase(e.target.value)}
          placeholder={DELETE_CONFIRM_PHRASE}
          className="field"
        />
        {otpEnabled && (
          <input
            type="text"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="OTP 코드"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="OTP 코드"
            className="field-code"
          />
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting} className="btn-danger w-full">
          {submitting ? "삭제 중..." : "계정과 모든 일기 영구 삭제"}
        </button>
        <button type="button" onClick={cancel} className="w-full text-center text-xs link">
          취소
        </button>
      </form>
    </section>
  );
}
