"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useSeed } from "@/contexts/SeedContext";
import { usePendingEntry } from "@/contexts/PendingEntryContext";
import { signInWithGoogle, signUpWithEmail } from "@/lib/firebase/auth";
import { isUserCancelledPopup, signUpErrorMessage } from "@/lib/firebase/authErrors";
import { createUserKeyRecord } from "@/lib/firebase/users";
import { writeEntry } from "@/lib/firebase/entries";
import {
  deriveHybridKeyPair,
  generateMasterSeed,
  recoverySecretToText,
  wipeBytes,
  wrapSeed,
} from "@/lib/crypto";
import { checkPassphraseStrength } from "@/lib/passphraseStrength";
import { PassphraseStrengthMeter } from "@/components/PassphraseStrengthMeter";
import { PasswordField, TextField } from "@/components/PasswordField";
import { AuthShell, OrDivider } from "@/components/AuthShell";
import { SecretReveal } from "@/components/SecretReveal";
import { SecretCard } from "@/components/SecretCard";
import { LoadingScreen } from "@/components/LoadingState";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useGoogleSignInAvailable } from "@/hooks/useGoogleSignInAvailable";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/navigation";
import { docHref } from "@/lib/site";

/** Backup codes issued during signup: any 2 of 3. Fewer pieces to place than /settings' 5-of-3 default, still no single point of failure. */
const ONBOARDING_SHARES = { n: 3, k: 2 };

type Step = "passphrase" | "backup-intro" | "backup-reveal";

function StepLabel({ step }: { step: 1 | 2 | 3 }) {
  return <p className="faint text-xs font-medium">{step} / 3단계</p>;
}

/**
 * Onboarding (ARCHITECTURE.md §3.1 step 1-5), in three steps:
 *
 *  1. Account — email/password or Google (Firebase Auth only).
 *  2. Diary passphrase — the master seed is generated here, wrapped with a
 *     passphrase that must differ from the login password and meet a
 *     minimum strength, and the key-issuance document is written.
 *  3. Backup codes — offered immediately, while the passphrase is still in
 *     hand to stage the seed, because "forget the passphrase, lose the
 *     diary" is this product's single biggest risk and a setting buried in
 *     /settings is one almost nobody goes back for. Skippable: whether an
 *     extra recoverable artifact is worth having stays the owner's call.
 *
 * If a visitor wrote on "/" first, that text (held in memory by
 * PendingEntryContext) is saved as the first entry as soon as step 2 has
 * created the keys — writing needs only the public keys.
 *
 * The login password only ever lives in loginPasswordRef, only long enough
 * to check the passphrase isn't the same value (ARCHITECTURE.md rule 5).
 */
export default function SignupPage() {
  const { user, status: authStatus } = useAuth();
  const {
    status: seedStatus,
    refresh,
    stageSeedFromPassphrase,
    prepareShamir,
    confirmPendingShamir,
    discardStagedSeed,
  } = useSeed();
  const { hasPendingEntry, takePendingEntry, setPendingEntry, setNotice } = usePendingEntry();
  const router = useRouter();
  const googleAvailable = useGoogleSignInAvailable();
  usePageTitle("가입");

  // --- step 1: account ---
  const [email, setEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountSubmitting, setAccountSubmitting] = useState(false);
  const loginPasswordRef = useRef<string>("");

  // --- step 2: passphrase ---
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [deriving, setDeriving] = useState(false);

  // --- step 3: backup codes ---
  const [step, setStep] = useState<Step>("passphrase");
  const [shares, setShares] = useState<Uint8Array[]>([]);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  // Set once this page creates the keys, so the "already onboarded →
  // leave" redirect below doesn't fire mid-onboarding when refresh() flips
  // seedStatus to "locked".
  const [onboarding, setOnboarding] = useState(false);
  const alreadyOnboarded = !onboarding && (seedStatus === "locked" || seedStatus === "unlocked");

  useEffect(() => {
    if (alreadyOnboarded) {
      router.replace(DEFAULT_SIGNED_IN_PATH);
    }
  }, [alreadyOnboarded, router]);

  // Leaving this page drops any seed staged for step 3.
  useEffect(() => () => discardStagedSeed(), [discardStagedSeed]);

  // Leaves onboarding for today's page. Doesn't touch the first-entry
  // notice set in step 2 — that has to survive to /write.
  function finish() {
    discardStagedSeed();
    router.replace(DEFAULT_SIGNED_IN_PATH);
  }

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccountError(null);
    setAccountSubmitting(true);
    try {
      await signUpWithEmail(email, accountPassword);
      loginPasswordRef.current = accountPassword;
      setAccountPassword("");
    } catch (err) {
      console.error("signUpWithEmail failed", err);
      setAccountError(signUpErrorMessage(err));
    } finally {
      setAccountSubmitting(false);
    }
  }

  async function handleGoogleSignUp() {
    setAccountError(null);
    setAccountSubmitting(true);
    try {
      await signInWithGoogle();
      // no login password to compare the passphrase against for this path
      loginPasswordRef.current = "";
    } catch (err) {
      if (!isUserCancelledPopup(err)) {
        console.error("signInWithGoogle failed", err);
        setAccountError(signUpErrorMessage(err));
      }
    } finally {
      setAccountSubmitting(false);
    }
  }

  async function handleSetPassphrase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPassphraseError(null);

    if (!user) return;
    if (passphrase !== passphraseConfirm) {
      setPassphraseError("일기 암호 확인이 일치하지 않습니다.");
      return;
    }
    const userInputs = [email, user.email ?? ""].filter(Boolean);
    if (!checkPassphraseStrength(passphrase, userInputs).isStrongEnough) {
      setPassphraseError("일기 암호가 너무 약합니다. 서로 관련 없는 단어를 더 이어 붙여 보세요.");
      return;
    }
    if (loginPasswordRef.current && passphrase === loginPasswordRef.current) {
      setPassphraseError("로그인 비밀번호와 다른 값이어야 합니다.");
      return;
    }

    setDeriving(true);
    let keysCreated = false;
    try {
      const seed = generateMasterSeed();
      const { publicKeys, privateKeys } = deriveHybridKeyPair(seed);
      const wrapped = await wrapSeed(seed, passphrase);
      wipeBytes(seed, privateKeys.x25519SecretKey, privateKeys.mlkem768SecretKey);

      setOnboarding(true);
      keysCreated = true;
      await createUserKeyRecord(user.uid, publicKeys, wrapped);
      loginPasswordRef.current = "";
      await refresh();

      const pendingText = takePendingEntry();
      if (pendingText) {
        try {
          await writeEntry(user.uid, publicKeys, pendingText);
          setNotice("첫 일기가 저장되었습니다.");
        } catch (err) {
          console.error("saving the pre-signup entry failed", err);
          // Hand it back so /write can offer it again instead of losing it.
          setPendingEntry(pendingText);
        }
      }

      // Stage the seed now, while the passphrase is in hand, so step 3
      // doesn't have to ask for it again seconds after it was chosen.
      await stageSeedFromPassphrase(passphrase);
      setPassphrase("");
      setPassphraseConfirm("");
      setStep("backup-intro");
    } catch (err) {
      console.error("handleSetPassphrase failed", err);
      if (!keysCreated) {
        setOnboarding(false);
        setPassphraseError("키를 저장하지 못했습니다. 다시 시도해주세요.");
        loginPasswordRef.current = "";
        setPassphrase("");
        setPassphraseConfirm("");
      } else {
        // Keys exist; only staging for step 3 failed. Backup codes can be
        // set up from /settings later.
        finish();
      }
    } finally {
      setDeriving(false);
    }
  }

  async function handleCreateBackupCodes() {
    setBackupError(null);
    setBackupBusy(true);
    try {
      setShares(await prepareShamir(ONBOARDING_SHARES.n, ONBOARDING_SHARES.k));
      setStep("backup-reveal");
    } catch (err) {
      console.error("prepareShamir failed", err);
      setBackupError("백업 코드를 만들지 못했습니다. 설정에서 다시 만들 수 있습니다.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleConfirmBackupCodes() {
    setBackupError(null);
    setBackupBusy(true);
    try {
      await confirmPendingShamir();
      setShares([]);
      finish();
    } catch (err) {
      console.error("confirmPendingShamir failed", err);
      setBackupError(
        "백업 코드를 저장하지 못했습니다. 방금 표시된 코드는 사용할 수 없습니다. 설정에서 다시 만들어 주세요."
      );
    } finally {
      setBackupBusy(false);
    }
  }

  if (
    authStatus === "loading" ||
    (authStatus === "signed-in" && (seedStatus === "unknown" || alreadyOnboarded))
  ) {
    return <LoadingScreen />;
  }

  if (authStatus === "signed-out") {
    return (
      <AuthShell
        title="계정 만들기"
        lead={
          hasPendingEntry ? "작성한 일기는 가입을 마치면 첫 일기로 저장됩니다." : undefined
        }
      >
        <StepLabel step={1} />
        <form onSubmit={handleCreateAccount} className="space-y-4">
          <TextField
            label="이메일"
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
          />
          <PasswordField
            label="로그인 비밀번호"
            autoComplete="new-password"
            value={accountPassword}
            onChange={setAccountPassword}
            hint="6자 이상. 일기 암호는 다음 단계에서 따로 정합니다."
          />
          {accountError && (
            <p role="alert" className="error-text">
              {accountError}
            </p>
          )}
          <button type="submit" disabled={accountSubmitting} className="btn-primary w-full">
            {accountSubmitting ? "처리 중..." : "가입하기"}
          </button>
        </form>
        {googleAvailable && (
          <>
            <OrDivider />
            <button
              type="button"
              onClick={() => void handleGoogleSignUp()}
              disabled={accountSubmitting}
              className="btn-secondary w-full"
            >
              Google로 계속하기
            </button>
          </>
        )}
        <p className="faint text-xs">
          가입하면 <Link href={docHref("/terms")} className="link">이용약관</Link>과{" "}
          <Link href={docHref("/privacy")} className="link">개인정보처리방침</Link>에 동의하는 것으로 봅니다.
        </p>
        <p className="text-center text-sm">
          <Link href="/login" className="link">
            이미 계정이 있으신가요? 로그인
          </Link>
        </p>
      </AuthShell>
    );
  }

  if (step === "backup-reveal" && shares.length > 0) {
    return (
      <main className="flex flex-1 flex-col items-center px-4 py-10 sm:px-6 sm:py-16">
        <div className="w-full max-w-lg space-y-3">
          <StepLabel step={3} />
          <SecretReveal
            title="백업 코드"
            description={`${ONBOARDING_SHARES.n}개 중 아무 ${ONBOARDING_SHARES.k}개를 모으면 일기 암호 없이 새 암호를 정할 수 있습니다. 서로 다른 곳에 나누어 보관하세요. 이 화면은 다시 표시되지 않습니다.`}
            confirmLabel={backupBusy ? "저장 중..." : "완료"}
            confirming={backupBusy}
            onConfirm={() => void handleConfirmBackupCodes()}
          >
            <div className="space-y-4">
              {shares.map((share, i) => (
                <SecretCard
                  key={i}
                  label={`코드 ${i + 1} / ${shares.length}`}
                  text={recoverySecretToText(share)}
                  filename={`privatediary-backup-code-${i + 1}-of-${shares.length}.txt`}
                />
              ))}
            </div>
          </SecretReveal>
          {backupError && (
            <p role="alert" className="error-text">
              {backupError}
            </p>
          )}
        </div>
      </main>
    );
  }

  if (step === "backup-intro") {
    return (
      <AuthShell
        title="백업 코드 만들기"
        lead={
          <>
            일기 암호를 잊으면 백업 코드로만 새 암호를 정할 수 있습니다. 지금 만들어 두는 것을 권장합니다.{" "}
            <Link href={docHref("/docs/backup-codes")} className="link whitespace-nowrap">
              자세히
            </Link>
          </>
        }
      >
        <StepLabel step={3} />
        {backupError && (
          <p role="alert" className="error-text">
            {backupError}
          </p>
        )}
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => void handleCreateBackupCodes()}
            disabled={backupBusy}
            className="btn-primary w-full"
          >
            {backupBusy ? "만드는 중..." : "백업 코드 만들기"}
          </button>
          <button type="button" onClick={finish} className="block w-full text-center text-sm link">
            나중에 설정에서 만들기
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="일기 암호 정하기"
      lead={
        <>
          일기를 여는 열쇠입니다. 서버로 전송되지 않으므로 잊으면 찾아 드릴 수 없습니다.{" "}
          <Link href={docHref("/docs/passphrase")} className="link whitespace-nowrap">
            자세히
          </Link>
        </>
      }
    >
      <StepLabel step={2} />
      <form onSubmit={handleSetPassphrase} className="space-y-4">
        <div className="space-y-2">
          <PasswordField
            label="일기 암호"
            autoComplete="passphrase"
            value={passphrase}
            onChange={setPassphrase}
            hint="로그인 비밀번호와 다른 값. 서로 관련 없는 단어 여러 개를 이어 쓰면 좋습니다."
          />
          <PassphraseStrengthMeter
            passphrase={passphrase}
            userInputs={[email, user?.email ?? ""].filter(Boolean)}
          />
        </div>
        <PasswordField
          label="일기 암호 확인"
          autoComplete="passphrase"
          value={passphraseConfirm}
          onChange={setPassphraseConfirm}
        />
        {passphraseError && (
          <p role="alert" className="error-text">
            {passphraseError}
          </p>
        )}
        <button type="submit" disabled={deriving} className="btn-primary w-full">
          {deriving ? "열쇠 만드는 중..." : "다음"}
        </button>
      </form>
    </AuthShell>
  );
}
