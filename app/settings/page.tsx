"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useOtp } from "@/contexts/OtpContext";
import { useSeed } from "@/contexts/SeedContext";
import { checkPassphraseStrength } from "@/lib/passphraseStrength";
import { PassphraseStrengthMeter } from "@/components/PassphraseStrengthMeter";
import { SecretReveal } from "@/components/SecretReveal";
import { SecretCard } from "@/components/SecretCard";
import { OtpQrCard } from "@/components/OtpQrCard";
import { LoadingScreen } from "@/components/LoadingState";
import { usePageTitle } from "@/hooks/usePageTitle";
import { IncorrectOtpCodeError, OtpLockedOutError, type OtpSetupMaterial } from "@/lib/firebase/otp";
import {
  InvalidShamirSharesError,
  WrongPassphraseError,
  recoverySecretToText,
  textToRecoverySecret,
} from "@/lib/crypto";

export default function SettingsPage() {
  const { user, status: authStatus } = useAuth();
  const {
    status: seedStatus,
    changePassphrase,
    resetPassphraseWithShamirShares,
    resetKeys,
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
      <ChangePassphraseSection changePassphrase={changePassphrase} />
      {shamirConfig && (
        <ResetPassphraseSection
          config={shamirConfig}
          resetPassphraseWithShamirShares={resetPassphraseWithShamirShares}
        />
      )}
      <OtpSection />

      <section className="w-full max-w-sm space-y-2">
        <h2 className="text-lg font-semibold">일기 복호화 방법</h2>
        <p className="muted">
          패스프레이즈와 Shamir 분산은 서로 동등한 자격입니다. 둘 중 무엇을 갖고 있어도 일기를
          복호화하고, 패스프레이즈를 재설정하고, Shamir 분산을 새로 발급할 수 있습니다. 단, 어느
          한쪽을 안다고 해서 다른 쪽의 실제 값을 알아낼 수는 없습니다. 평소에는 패스프레이즈를
          쓰고, 그마저 잃어버렸을 때를 위한 비상 수단이 Shamir 분산입니다.
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

      <ResetKeysSection userEmail={user?.email ?? ""} resetKeys={resetKeys} />
    </main>
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
      setError("새 패스프레이즈 확인이 일치하지 않습니다.");
      return;
    }
    if (!checkPassphraseStrength(newPassphrase).isStrongEnough) {
      setError("새 패스프레이즈가 너무 약합니다.");
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
          ? "기존 패스프레이즈가 올바르지 않습니다."
          : "패스프레이즈를 변경하지 못했습니다."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="w-full max-w-sm space-y-4">
      <h2 className="text-lg font-semibold">패스프레이즈 변경</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="password"
          required
          autoComplete="current-password"
          aria-label="기존 패스프레이즈"
          value={oldPassphrase}
          onChange={(e) => setOldPassphrase(e.target.value)}
          placeholder="기존 패스프레이즈"
          className="field"
        />
        <input
          type="password"
          required
          autoComplete="new-password"
          aria-label="새 패스프레이즈"
          value={newPassphrase}
          onChange={(e) => setNewPassphrase(e.target.value)}
          placeholder="새 패스프레이즈"
          className="field"
        />
        <PassphraseStrengthMeter passphrase={newPassphrase} />
        <input
          type="password"
          required
          autoComplete="new-password"
          aria-label="새 패스프레이즈 확인"
          value={confirmPassphrase}
          onChange={(e) => setConfirmPassphrase(e.target.value)}
          placeholder="새 패스프레이즈 확인"
          className="field"
        />
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="success-text">
            패스프레이즈가 변경되었습니다.
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
 * Passphrase reset via Shamir shares — for when the passphrase itself is
 * forgotten, not just being routinely changed. No old passphrase is needed;
 * K shares prove the same underlying master credential (contexts/
 * SeedContext.tsx's doc comment). Only shown once Shamir is configured.
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
      setError("새 패스프레이즈 확인이 일치하지 않습니다.");
      return;
    }
    if (!checkPassphraseStrength(newPassphrase).isStrongEnough) {
      setError("새 패스프레이즈가 너무 약합니다.");
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
          ? "조각들이 올바른 시드로 복원되지 않습니다."
          : "재설정하지 못했습니다."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="w-full max-w-sm space-y-4 card">
      <div>
        <h2 className="text-lg font-semibold">패스프레이즈를 잊으셨나요?</h2>
        <p className="mt-1 muted">
          Shamir 분산 {config.k}개를 모으면 기존 일기를 그대로 유지한 채 새 패스프레이즈를 설정할
          수 있습니다.
        </p>
      </div>
      {success && (
        <p role="status" className="success-text">
          패스프레이즈가 재설정되었습니다.
        </p>
      )}
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="btn-secondary w-full">
          Shamir 분산으로 재설정
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          {shareInputs.map((value, i) => (
            <input
              key={i}
              type="text"
              required
              aria-label={`Shamir 조각 ${i + 1}`}
              value={value}
              onChange={(e) =>
                setShareInputs((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
              }
              placeholder={`조각 ${i + 1}`}
              className="field-mono"
            />
          ))}
          <input
            type="password"
            required
            autoComplete="new-password"
            aria-label="새 패스프레이즈"
            value={newPassphrase}
            onChange={(e) => setNewPassphrase(e.target.value)}
            placeholder="새 패스프레이즈"
            className="field"
          />
          <PassphraseStrengthMeter passphrase={newPassphrase} />
          <input
            type="password"
            required
            autoComplete="new-password"
            aria-label="새 패스프레이즈 확인"
            value={confirmPassphrase}
            onChange={(e) => setConfirmPassphrase(e.target.value)}
            placeholder="새 패스프레이즈 확인"
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
 * the diary's encryption. Enabling requires scanning a QR and confirming
 * one live code; disabling requires a currently-valid code.
 */
type OtpPhase = "status" | "setup" | "disable";

function OtpSection() {
  const { loading, otpEnabled, startSetup, confirmSetup, disable } = useOtp();
  const [phase, setPhase] = useState<OtpPhase>("status");
  const [setupMaterial, setSetupMaterial] = useState<OtpSetupMaterial | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function otpErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof IncorrectOtpCodeError) return "코드가 올바르지 않습니다.";
    if (err instanceof OtpLockedOutError) return "시도 횟수를 초과했습니다. 잠시 후 다시 시도하세요.";
    return fallback;
  }

  async function handleStart() {
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const material = await startSetup();
      setSetupMaterial(material);
      setPhase("setup");
    } catch {
      setError("OTP 설정을 시작하지 못했습니다.");
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
    setPhase("status");
    setSetupMaterial(null);
    setCode("");
    setError(null);
  }

  if (loading) {
    return null;
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
          onClick={() => void handleStart()}
          disabled={submitting}
          className="btn-primary w-full"
        >
          {submitting ? "준비 중..." : "OTP 활성화"}
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
    if (err instanceof WrongPassphraseError) return "패스프레이즈가 올바르지 않습니다.";
    if (err instanceof InvalidShamirSharesError) return "조각들이 올바른 시드로 복원되지 않습니다.";
    return "본인 확인에 실패했습니다.";
  }

  async function handleProveForSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (newK < 2 || newN < newK || newN > 10) {
      setError("조각 수(N)는 2~10, 필요 조각 수(K)는 2 이상이면서 N 이하여야 합니다.");
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
      setMessage(config ? "Shamir 분산이 재발급되었습니다." : "Shamir 분산이 활성화되었습니다.");
    } catch (err) {
      console.error("confirmPendingShamir failed", err);
      setError("저장하지 못했습니다. 다시 시도해주세요.");
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
      setMessage("Shamir 분산이 비활성화되었습니다.");
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
        패스프레이즈로 인증
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={proveMode === "shamir"}
        disabled={!config}
        onClick={() => setProveMode("shamir")}
        className={`btn-sm flex-1 ${proveMode === "shamir" ? "btn-primary" : "btn-secondary"}`}
      >
        기존 조각으로 인증
      </button>
    </div>
  );

  if (phase === "reveal" && revealedShares.length > 0) {
    return (
      <section className="w-full max-w-lg space-y-3">
        <SecretReveal
          title="Shamir 분산 조각"
          description={`총 ${revealedShares.length}개의 조각 중 ${newK}개를 모으면 시드를 복원할 수 있습니다. 조각 하나만으로는 아무 의미가 없으니, 각 조각을 서로 다른 안전한 곳에 나눠 보관하세요. 이전에 발급된 조각이 있었다면 이제 무효가 됩니다. 이 화면은 다시 표시되지 않습니다.`}
          confirmLabel={submitting ? "저장 중..." : "완료 — 이 조각들을 활성화합니다"}
          confirming={submitting}
          onConfirm={() => void handleConfirmReveal()}
        >
          <div className="space-y-4">
            {revealedShares.map((share, i) => (
              <SecretCard
                key={i}
                label={`조각 ${i + 1} / ${revealedShares.length}`}
                text={recoverySecretToText(share)}
                filename={`privatediary-shamir-share-${i + 1}-of-${revealedShares.length}.txt`}
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
        <h2 className="text-lg font-semibold">{config ? "Shamir 분산 재발급" : "Shamir 분산 활성화"}</h2>
        <form onSubmit={handleProveForSetup} className="space-y-3">
          {proveModeToggle}
          {proveMode === "passphrase" ? (
            <input
              type="password"
              required
              autoComplete="current-password"
              aria-label="패스프레이즈"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="패스프레이즈"
              className="field"
            />
          ) : (
            <div className="space-y-2">
              {proofShares.map((value, i) => (
                <input
                  key={i}
                  type="text"
                  required
                  aria-label={`Shamir 조각 ${i + 1}`}
                  value={value}
                  onChange={(e) =>
                    setProofShares((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
                  }
                  placeholder={`조각 ${i + 1}`}
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
        <h2 className="text-lg font-semibold">Shamir 분산 비활성화</h2>
        <form onSubmit={handleProveForDisable} className="space-y-3">
          {proveModeToggle}
          {proveMode === "passphrase" ? (
            <input
              type="password"
              required
              autoComplete="current-password"
              aria-label="패스프레이즈"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="패스프레이즈"
              className="field"
            />
          ) : (
            <div className="space-y-2">
              {proofShares.map((value, i) => (
                <input
                  key={i}
                  type="text"
                  required
                  aria-label={`Shamir 조각 ${i + 1}`}
                  value={value}
                  onChange={(e) =>
                    setProofShares((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
                  }
                  placeholder={`조각 ${i + 1}`}
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
        Shamir 분산:{" "}
        <strong>{config ? `사용 중 (${config.n}개 중 ${config.k}개 필요)` : "사용 안 함"}</strong>
      </p>
      <p className="text-xs text-zinc-500">
        N개 조각으로 나눠, K개를 모아야 잠금 해제. 조각 하나만 유출되면 무의미해 더 안전합니다.
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

const RESET_CONFIRM_PHRASE = "초기화합니다";

function ResetKeysSection({
  userEmail,
  resetKeys,
}: {
  userEmail: string;
  resetKeys: (newPassphrase: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (confirmPhrase !== RESET_CONFIRM_PHRASE) {
      setError(`확인 문구를 정확히 입력해주세요: "${RESET_CONFIRM_PHRASE}"`);
      return;
    }
    if (newPassphrase !== confirmPassphrase) {
      setError("새 패스프레이즈 확인이 일치하지 않습니다.");
      return;
    }
    if (!checkPassphraseStrength(newPassphrase, [userEmail]).isStrongEnough) {
      setError("새 패스프레이즈가 너무 약합니다.");
      return;
    }

    setSubmitting(true);
    try {
      await resetKeys(newPassphrase);
      setDone(true);
      setOpen(false);
    } catch (err) {
      console.error("resetKeys failed", err);
      setError("초기화하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="w-full max-w-sm space-y-4 card-danger">
      <div>
        <h2 className="text-lg font-semibold text-red-700 dark:text-red-500">초기화</h2>
        <p className="mt-2 muted">
          패스프레이즈와 Shamir 분산을 모두 잃어버렸다면 새 시드를 발급하는 방법뿐입니다.{" "}
          <strong>지금까지 작성한 모든 일기는 영구히 복호화할 수 없게 됩니다.</strong> 설정해둔
          Shamir 분산도 함께 꺼집니다. 이 작업은 되돌릴 수 없습니다.
        </p>
      </div>

      {done && (
        <p role="status" className="success-text">
          초기화되었습니다. 새 패스프레이즈로 로그인하세요.
        </p>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setDone(false);
          }}
          className="btn-danger-outline w-full"
        >
          초기화 시작
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <p className="muted">
            계속하려면 아래에 <code className="font-mono">{RESET_CONFIRM_PHRASE}</code>를
            입력하세요.
          </p>
          <input
            type="text"
            required
            aria-label="확인 문구"
            value={confirmPhrase}
            onChange={(e) => setConfirmPhrase(e.target.value)}
            placeholder={RESET_CONFIRM_PHRASE}
            className="field"
          />
          <input
            type="password"
            required
            autoComplete="new-password"
            aria-label="새 패스프레이즈"
            value={newPassphrase}
            onChange={(e) => setNewPassphrase(e.target.value)}
            placeholder="새 패스프레이즈"
            className="field"
          />
          <PassphraseStrengthMeter passphrase={newPassphrase} userInputs={[userEmail]} />
          <input
            type="password"
            required
            autoComplete="new-password"
            aria-label="새 패스프레이즈 확인"
            value={confirmPassphrase}
            onChange={(e) => setConfirmPassphrase(e.target.value)}
            placeholder="새 패스프레이즈 확인"
            className="field"
          />
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <button type="submit" disabled={submitting} className="btn-danger w-full">
            {submitting ? "초기화 중..." : "영구적으로 초기화"}
          </button>
        </form>
      )}
    </section>
  );
}
