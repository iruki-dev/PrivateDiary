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
import { AuthShell, OrDivider, StepProgress } from "@/components/AuthShell";
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
      setPassphraseError("두 칸에 같은 일기 암호를 넣어 주세요.");
      return;
    }
    const userInputs = [email, user.email ?? ""].filter(Boolean);
    if (!checkPassphraseStrength(passphrase, userInputs).isStrongEnough) {
      setPassphraseError("일기 암호가 너무 짧아요. 서로 상관없는 단어를 더 이어 붙여 보세요.");
      return;
    }
    if (loginPasswordRef.current && passphrase === loginPasswordRef.current) {
      setPassphraseError("로그인 비밀번호와 다르게 정해 주세요.");
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
          setNotice("첫 일기를 저장했어요");
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
        setPassphraseError("일기장을 만들지 못했어요. 다시 시도해 주세요.");
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
      setBackupError("백업 코드를 만들지 못했어요. 설정에서 다시 만들 수 있어요.");
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
        "백업 코드를 저장하지 못했어요. 방금 보인 코드는 쓸 수 없으니 설정에서 다시 만들어 주세요."
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
        step={1}
        lead={hasPendingEntry ? "쓴 일기는 가입을 마치면 첫 일기로 저장돼요." : undefined}
      >
        <form onSubmit={handleCreateAccount} className="space-y-4">
          <TextField
            label="이메일"
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            placeholder="name@example.com"
          />
          <PasswordField
            label="로그인 비밀번호"
            autoComplete="new-password"
            value={accountPassword}
            onChange={setAccountPassword}
            hint="6자 이상이면 돼요. 일기 암호는 다음 단계에서 따로 정해요."
          />
          {accountError && (
            <p role="alert" className="error-text">
              {accountError}
            </p>
          )}
          <button type="submit" disabled={accountSubmitting} className="btn-primary min-h-14 w-full rounded-2xl text-[1.0625rem]">
            {accountSubmitting ? "만드는 중…" : "계정 만들기"}
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
        <p className="faint text-[0.8125rem] leading-relaxed">
          가입하면 <Link href={docHref("/terms")} className="link">이용약관</Link>과{" "}
          <Link href={docHref("/privacy")} className="link">개인정보처리방침</Link>에 동의하게 돼요.
        </p>
        <p className="text-center">
          <Link href="/login" className="btn-text">
            이미 계정이 있어요
          </Link>
        </p>
      </AuthShell>
    );
  }

  if (step === "backup-reveal" && shares.length > 0) {
    return (
      <main className="flex flex-1 flex-col items-center px-5 pb-10 pt-6 sm:px-6 sm:py-16">
        <div className="w-full max-w-md space-y-3">
          <StepProgress step={3} />
          <SecretReveal
            title="백업 코드를 적어 두세요"
            description={`일기 암호를 잊어도 ${ONBOARDING_SHARES.n}개 중 ${ONBOARDING_SHARES.k}개만 있으면 일기장을 열 수 있어요. 서로 다른 곳에 나눠 두면 하나를 잃어도 괜찮아요. 이 화면을 닫으면 다시 볼 수 없어요.`}
            confirmLabel={backupBusy ? "저장하는 중…" : "첫 일기 쓰러 가기"}
            confirming={backupBusy}
            onConfirm={() => void handleConfirmBackupCodes()}
          >
            <div className="space-y-4">
              {shares.map((share, i) => (
                <SecretCard
                  key={i}
                  label={`코드 ${i + 1}`}
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
        step={3}
        lead={
          <>
            백업 코드가 있으면 일기 암호를 잊어도 일기장을 열 수 있어요. 지금 만들어 두면 안심이에요.{" "}
            <Link href={docHref("/docs/backup-codes")} className="link whitespace-nowrap">
              자세히
            </Link>
          </>
        }
      >
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
            className="btn-primary min-h-14 w-full rounded-2xl text-[1.0625rem]"
          >
            {backupBusy ? "만드는 중…" : "백업 코드 만들기"}
          </button>
          <button type="button" onClick={finish} className="btn-text w-full">
            나중에 설정에서 만들기
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="일기 암호를 정해 주세요"
      step={2}
      lead={
        <>
          일기장을 여는 열쇠예요. 어디에도 저장하지 않아서, 잊으면 누구도 대신 찾아 줄 수 없어요.{" "}
          <Link href={docHref("/docs/passphrase")} className="link whitespace-nowrap">
            자세히
          </Link>
        </>
      }
    >
      <form onSubmit={handleSetPassphrase} className="space-y-5">
        <div className="space-y-2">
          <PasswordField
            label="일기 암호"
            autoComplete="passphrase"
            value={passphrase}
            onChange={setPassphrase}
          />
          <PassphraseStrengthMeter
            passphrase={passphrase}
            userInputs={[email, user?.email ?? ""].filter(Boolean)}
          />
          <p className="text-[0.8125rem] leading-relaxed text-ink-3">
            로그인 비밀번호와 다르게, 서로 상관없는 단어 4개 정도를 띄어 쓰면 기억하기 쉽고 안전해요. 비밀번호
            관리 앱도 이 암호는 기억하지 않아요.
          </p>
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
        <button type="submit" disabled={deriving} className="btn-primary min-h-14 w-full rounded-2xl text-[1.0625rem]">
          {deriving ? "일기장을 만드는 중…" : "다음"}
        </button>
      </form>
    </AuthShell>
  );
}
