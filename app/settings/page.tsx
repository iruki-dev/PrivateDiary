"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useSeed } from "@/contexts/SeedContext";
import { checkPassphraseStrength } from "@/lib/passphraseStrength";
import { PassphraseStrengthMeter } from "@/components/PassphraseStrengthMeter";
import { SecretReveal } from "@/components/SecretReveal";
import { SecretCard } from "@/components/SecretCard";
import {
  InvalidRecoveryKeyError,
  InvalidShamirSharesError,
  WrongPassphraseError,
  recoverySecretToText,
  textToRecoverySecret,
  type RecoveryConfig,
} from "@/lib/crypto";

export default function SettingsPage() {
  const { user, status: authStatus } = useAuth();
  const {
    status: seedStatus,
    changePassphrase,
    resetKeys,
    recoveryConfig,
    stageSeedFromPassphrase,
    stageSeedFromRecoveryKey,
    stageSeedFromShamirShares,
    discardStagedSeed,
    prepareRecoveryKey,
    prepareShamirRecovery,
    confirmPendingRecovery,
    commitRemoveRecovery,
  } = useSeed();
  const router = useRouter();

  useEffect(() => {
    if (authStatus === "signed-in" && seedStatus === "not-issued") {
      router.replace("/signup");
    }
  }, [authStatus, seedStatus, router]);

  if (authStatus !== "signed-in" || seedStatus === "unknown" || seedStatus === "not-issued") {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">확인 중...</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center gap-12 px-6 py-24">
      <ChangePassphraseSection changePassphrase={changePassphrase} />
      <RecoverySection
        recoveryConfig={recoveryConfig}
        stageSeedFromPassphrase={stageSeedFromPassphrase}
        stageSeedFromRecoveryKey={stageSeedFromRecoveryKey}
        stageSeedFromShamirShares={stageSeedFromShamirShares}
        discardStagedSeed={discardStagedSeed}
        prepareRecoveryKey={prepareRecoveryKey}
        prepareShamirRecovery={prepareShamirRecovery}
        confirmPendingRecovery={confirmPendingRecovery}
        commitRemoveRecovery={commitRemoveRecovery}
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
          value={oldPassphrase}
          onChange={(e) => setOldPassphrase(e.target.value)}
          placeholder="기존 패스프레이즈"
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          type="password"
          required
          value={newPassphrase}
          onChange={(e) => setNewPassphrase(e.target.value)}
          placeholder="새 패스프레이즈"
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <PassphraseStrengthMeter passphrase={newPassphrase} />
        <input
          type="password"
          required
          value={confirmPassphrase}
          onChange={(e) => setConfirmPassphrase(e.target.value)}
          placeholder="새 패스프레이즈 확인"
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">패스프레이즈가 변경되었습니다.</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {submitting ? "변경 중..." : "변경하기"}
        </button>
      </form>
    </section>
  );
}

/**
 * Recovery method management (replaces the removed BIP39 mnemonic).
 * Two-phase flow: STAGE proves identity (passphrase if none is configured
 * yet, otherwise the currently-configured method itself), then COMMIT
 * installs a new method or removes the current one. See
 * contexts/SeedContext.tsx's doc comment for the full rationale.
 */
type RecoveryPhase =
  | "status"
  | "enter-passphrase"
  | "enter-recovery-key"
  | "enter-shamir-shares"
  | "choose-new-method"
  | "reveal-key"
  | "reveal-shamir";

function RecoverySection({
  recoveryConfig,
  stageSeedFromPassphrase,
  stageSeedFromRecoveryKey,
  stageSeedFromShamirShares,
  discardStagedSeed,
  prepareRecoveryKey,
  prepareShamirRecovery,
  confirmPendingRecovery,
  commitRemoveRecovery,
}: {
  recoveryConfig: RecoveryConfig | null;
  stageSeedFromPassphrase: (passphrase: string) => Promise<void>;
  stageSeedFromRecoveryKey: (key: Uint8Array) => Promise<void>;
  stageSeedFromShamirShares: (shares: Uint8Array[]) => Promise<void>;
  discardStagedSeed: () => void;
  prepareRecoveryKey: () => Promise<Uint8Array>;
  prepareShamirRecovery: (n: number, k: number) => Promise<Uint8Array[]>;
  confirmPendingRecovery: () => Promise<void>;
  commitRemoveRecovery: () => Promise<void>;
}) {
  const [phase, setPhase] = useState<RecoveryPhase>("status");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [passphrase, setPassphrase] = useState("");
  const [recoveryKeyInput, setRecoveryKeyInput] = useState("");
  const [shareInputs, setShareInputs] = useState<string[]>([]);

  const [newN, setNewN] = useState(5);
  const [newK, setNewK] = useState(3);

  const [revealedKey, setRevealedKey] = useState<Uint8Array | null>(null);
  const [revealedShares, setRevealedShares] = useState<Uint8Array[]>([]);

  useEffect(() => {
    // If the user navigates away mid-flow, don't leave a proven seed
    // sitting in memory unused.
    return () => discardStagedSeed();
  }, [discardStagedSeed]);

  function cancel() {
    discardStagedSeed();
    setPhase("status");
    setError(null);
    setPassphrase("");
    setRecoveryKeyInput("");
    setShareInputs([]);
  }

  function startCreate() {
    setError(null);
    setPhase("enter-passphrase");
  }

  function startChangeOrRemove() {
    setError(null);
    if (recoveryConfig?.type === "recovery-key") {
      setPhase("enter-recovery-key");
    } else if (recoveryConfig?.type === "shamir") {
      setShareInputs(Array(recoveryConfig.k).fill(""));
      setPhase("enter-shamir-shares");
    }
  }

  async function handlePassphraseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await stageSeedFromPassphrase(passphrase);
      setPassphrase("");
      setPhase("choose-new-method");
    } catch (err) {
      setError(err instanceof WrongPassphraseError ? "패스프레이즈가 올바르지 않습니다." : "확인하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecoveryKeySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await stageSeedFromRecoveryKey(textToRecoverySecret(recoveryKeyInput));
      setRecoveryKeyInput("");
      setPhase("choose-new-method");
    } catch (err) {
      setError(
        err instanceof InvalidRecoveryKeyError
          ? "복구 키가 올바르지 않습니다."
          : "복구 키 형식이 올바르지 않습니다."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleShamirSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const shares = shareInputs.map((s) => textToRecoverySecret(s));
      await stageSeedFromShamirShares(shares);
      setShareInputs([]);
      setPhase("choose-new-method");
    } catch (err) {
      setError(
        err instanceof InvalidShamirSharesError
          ? "조각들이 올바른 시드로 복원되지 않습니다."
          : "조각 형식이 올바르지 않습니다."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePrepareRecoveryKey() {
    setError(null);
    setSubmitting(true);
    try {
      const key = await prepareRecoveryKey();
      setRevealedKey(key);
      setPhase("reveal-key");
    } catch {
      setError("복구 키를 준비하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePrepareShamir() {
    setError(null);
    if (newK < 2 || newN < newK || newN > 10) {
      setError("조각 수(N)는 2~10, 필요 조각 수(K)는 2 이상이면서 N 이하여야 합니다.");
      return;
    }
    setSubmitting(true);
    try {
      const shares = await prepareShamirRecovery(newN, newK);
      setRevealedShares(shares);
      setPhase("reveal-shamir");
    } catch {
      setError("Shamir 분산을 준비하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  function cancelReveal() {
    discardStagedSeed();
    setRevealedKey(null);
    setRevealedShares([]);
    setError(null);
    setPhase("status");
  }

  async function handleConfirmReveal(successMessage: string) {
    setSubmitting(true);
    try {
      // The write to Firestore only happens here — after the user has
      // acknowledged (via SecretReveal's checkbox) that they saved the
      // material. Leaving the page before this point discards everything
      // that was prepared, so there's never a recovery method configured
      // in Firestore that nobody actually holds the key/shares for.
      await confirmPendingRecovery();
      setRevealedKey(null);
      setRevealedShares([]);
      setPhase("status");
      setStatusMessage(successMessage);
    } catch {
      setError("복구 수단을 저장하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCommitRemove() {
    setError(null);
    setSubmitting(true);
    try {
      await commitRemoveRecovery();
      setPhase("status");
      setStatusMessage("복구 수단이 제거되었습니다.");
    } catch {
      setError("복구 수단을 제거하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === "reveal-key" && revealedKey) {
    return (
      <section className="w-full max-w-lg space-y-3">
        <SecretReveal
          title="복구 키"
          description="이 키가 있으면 패스프레이즈 없이도 일기를 복호화할 수 있습니다. 안전한 곳(금고, 비밀번호 관리자 등)에 보관하세요. 이 화면은 다시 표시되지 않습니다."
          confirmLabel={submitting ? "저장 중..." : "완료 — 이 키를 설정합니다"}
          confirming={submitting}
          onConfirm={() => void handleConfirmReveal("복구 키가 설정되었습니다.")}
        >
          <SecretCard
            label="복구 키"
            text={recoverySecretToText(revealedKey)}
            filename="privatediary-recovery-key.txt"
          />
        </SecretReveal>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="button" onClick={cancelReveal} className="w-full text-center text-xs underline">
          취소 (설정하지 않음)
        </button>
      </section>
    );
  }

  if (phase === "reveal-shamir" && revealedShares.length > 0) {
    return (
      <section className="w-full max-w-lg space-y-3">
        <SecretReveal
          title="Shamir 복구 조각"
          description={`총 ${revealedShares.length}개의 조각 중 ${newK}개를 모으면 시드를 복구할 수 있습니다. 조각 하나만으로는 아무 의미가 없으니, 각 조각을 서로 다른 안전한 곳에 나눠 보관하세요. 이 화면은 다시 표시되지 않습니다.`}
          confirmLabel={submitting ? "저장 중..." : "완료 — 이 조각들을 설정합니다"}
          confirming={submitting}
          onConfirm={() => void handleConfirmReveal("Shamir 복구 조각이 설정되었습니다.")}
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
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="button" onClick={cancelReveal} className="w-full text-center text-xs underline">
          취소 (설정하지 않음)
        </button>
      </section>
    );
  }

  if (phase === "choose-new-method") {
    return (
      <section className="w-full max-w-sm space-y-4">
        <h2 className="text-lg font-semibold">복구 수단 설정</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">본인 확인이 완료되었습니다. 새 복구 수단을 선택하세요.</p>

        <div className="space-y-2 rounded border border-zinc-300 p-4 dark:border-zinc-700">
          <p className="text-sm font-medium">복구 키</p>
          <p className="text-xs text-zinc-500">랜덤 키 하나로 복구. 간단하지만, 그 키 하나가 유출되면 그대로 노출됩니다.</p>
          <button
            type="button"
            onClick={() => void handlePrepareRecoveryKey()}
            disabled={submitting}
            className="w-full rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
          >
            복구 키로 설정
          </button>
        </div>

        <div className="space-y-2 rounded border border-zinc-300 p-4 dark:border-zinc-700">
          <p className="text-sm font-medium">Shamir 분산</p>
          <p className="text-xs text-zinc-500">N개 조각으로 나눠, K개를 모아야 복구. 조각 하나만 유출되면 무의미해 더 안전합니다.</p>
          <div className="flex gap-2">
            <label className="flex-1 text-xs">
              전체(N)
              <input
                type="number"
                min={2}
                max={10}
                value={newN}
                onChange={(e) => setNewN(Number(e.target.value))}
                className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
                className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => void handlePrepareShamir()}
            disabled={submitting}
            className="w-full rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
          >
            Shamir 분산으로 설정
          </button>
        </div>

        {recoveryConfig?.type !== "none" && (
          <button
            type="button"
            onClick={() => void handleCommitRemove()}
            disabled={submitting}
            className="w-full rounded border border-red-600 px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50 dark:text-red-500"
          >
            복구 수단 제거만 하기 (설정 안 함)
          </button>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="button" onClick={cancel} className="w-full text-center text-xs underline">
          취소
        </button>
      </section>
    );
  }

  if (phase === "enter-passphrase") {
    return (
      <section className="w-full max-w-sm space-y-4">
        <h2 className="text-lg font-semibold">복구 수단 설정</h2>
        <form onSubmit={handlePassphraseSubmit} className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">본인 확인을 위해 패스프레이즈를 입력하세요.</p>
          <input
            type="password"
            required
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="패스프레이즈"
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {submitting ? "확인 중..." : "다음"}
          </button>
          <button type="button" onClick={cancel} className="w-full text-center text-xs underline">
            취소
          </button>
        </form>
      </section>
    );
  }

  if (phase === "enter-recovery-key") {
    return (
      <section className="w-full max-w-sm space-y-4">
        <h2 className="text-lg font-semibold">복구 수단 변경/제거</h2>
        <form onSubmit={handleRecoveryKeySubmit} className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            현재 설정된 복구 키를 입력해 본인 확인을 해주세요.
          </p>
          <input
            type="text"
            required
            value={recoveryKeyInput}
            onChange={(e) => setRecoveryKeyInput(e.target.value)}
            placeholder="복구 키"
            className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {submitting ? "확인 중..." : "다음"}
          </button>
          <button type="button" onClick={cancel} className="w-full text-center text-xs underline">
            취소
          </button>
        </form>
      </section>
    );
  }

  if (phase === "enter-shamir-shares" && recoveryConfig?.type === "shamir") {
    return (
      <section className="w-full max-w-sm space-y-4">
        <h2 className="text-lg font-semibold">복구 수단 변경/제거</h2>
        <form onSubmit={handleShamirSubmit} className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            본인 확인을 위해 {recoveryConfig.k}개의 조각을 입력하세요.
          </p>
          {shareInputs.map((value, i) => (
            <input
              key={i}
              type="text"
              required
              value={value}
              onChange={(e) =>
                setShareInputs((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
              }
              placeholder={`조각 ${i + 1}`}
              className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
          ))}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {submitting ? "확인 중..." : "다음"}
          </button>
          <button type="button" onClick={cancel} className="w-full text-center text-xs underline">
            취소
          </button>
        </form>
      </section>
    );
  }

  const statusLabel =
    recoveryConfig?.type === "recovery-key"
      ? "복구 키"
      : recoveryConfig?.type === "shamir"
        ? `Shamir 분산 (${recoveryConfig.n}개 중 ${recoveryConfig.k}개 필요)`
        : "없음";

  return (
    <section className="w-full max-w-sm space-y-4">
      <h2 className="text-lg font-semibold">복구 수단</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        패스프레이즈를 잊었을 때를 대비한 별도 수단입니다. 선택 사항이며, 두지 않는 것이 가장
        안전합니다(훔칠 대상 자체가 없으므로). 현재: <strong>{statusLabel}</strong>
      </p>
      {statusMessage && <p className="text-sm text-green-600">{statusMessage}</p>}
      {recoveryConfig?.type === "none" ? (
        <button
          type="button"
          onClick={startCreate}
          className="w-full rounded bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          복구 수단 설정하기
        </button>
      ) : (
        <button
          type="button"
          onClick={startChangeOrRemove}
          className="w-full rounded border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
        >
          변경 또는 제거
        </button>
      )}
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
    } catch {
      setError("초기화하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="w-full max-w-sm space-y-4 rounded border border-red-300 p-4 dark:border-red-900">
      <div>
        <h2 className="text-lg font-semibold text-red-700 dark:text-red-500">초기화</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          기존 패스프레이즈를 모른다면 새 시드를 발급하는 방법뿐입니다. <strong>지금까지 작성한
          모든 일기는 영구히 복호화할 수 없게 됩니다.</strong> 기존에 설정한 복구 수단도 함께
          제거됩니다. 이 작업은 되돌릴 수 없습니다.
        </p>
      </div>

      {done && <p className="text-sm text-green-600">초기화되었습니다. 새 패스프레이즈로 로그인하세요.</p>}

      {!open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setDone(false);
          }}
          className="w-full rounded border border-red-600 px-4 py-2 text-sm font-medium text-red-700 dark:text-red-500"
        >
          초기화 시작
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            계속하려면 아래에 <code className="font-mono">{RESET_CONFIRM_PHRASE}</code>를
            입력하세요.
          </p>
          <input
            type="text"
            required
            value={confirmPhrase}
            onChange={(e) => setConfirmPhrase(e.target.value)}
            placeholder={RESET_CONFIRM_PHRASE}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <input
            type="password"
            required
            value={newPassphrase}
            onChange={(e) => setNewPassphrase(e.target.value)}
            placeholder="새 패스프레이즈"
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <PassphraseStrengthMeter passphrase={newPassphrase} userInputs={[userEmail]} />
          <input
            type="password"
            required
            value={confirmPassphrase}
            onChange={(e) => setConfirmPassphrase(e.target.value)}
            placeholder="새 패스프레이즈 확인"
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "초기화 중..." : "영구적으로 초기화"}
          </button>
        </form>
      )}
    </section>
  );
}
