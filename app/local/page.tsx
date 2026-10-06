"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "@/contexts/AccountContext";
import { useSeed } from "@/contexts/SeedContext";
import {
  deriveHybridKeyPair,
  generateMasterSeed,
  recoverySecretToText,
  wipeBytes,
  wrapSeed,
} from "@/lib/crypto";
import { checkPassphraseStrength } from "@/lib/passphraseStrength";
import { existingLocalDiaryId } from "@/lib/deviceMode";
import { localDiaryExists } from "@/lib/store/local";
import { IS_ANDROID_APP } from "@/lib/platform";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/navigation";
import { nicknameProblem, normalizeNickname, NICKNAME_MAX_LENGTH } from "@/lib/loginId";
import { docHref } from "@/lib/site";
import { AuthShell, StepProgress } from "@/components/AuthShell";
import { PasswordField, TextField } from "@/components/PasswordField";
import { PassphraseStrengthMeter } from "@/components/PassphraseStrengthMeter";
import { SecretReveal } from "@/components/SecretReveal";
import { SecretCard } from "@/components/SecretCard";
import { LoadingScreen } from "@/components/LoadingState";
import { Icon } from "@/components/Icon";
import { usePageTitle } from "@/hooks/usePageTitle";

/** Same as signup: any 2 of 3. */
const LOCAL_SHARES = { n: 3, k: 2 };

type Step = "passphrase" | "backup-intro" | "backup-reveal";

/**
 * "서버 없이 이 휴대폰에만 쓰기" (Android app only): the fully local diary
 * (lib/store/local.ts, lib/deviceMode.ts).
 *
 * Before the switch: what it means, in plain words — no account, the app
 * cut off from the network, and no copy anywhere else unless the owner
 * exports one. After it: the same setup as signup's steps 2–3 (diary
 * passphrase, then backup codes), with the same crypto; only where the
 * keys and entries are kept differs. A local diary started earlier on this
 * phone is simply reopened.
 */
export default function LocalPage() {
  const router = useRouter();
  const { mode, status: accountStatus, account, store, startLocalMode, leaveLocalMode } = useAccount();
  const {
    status: seedStatus,
    refresh,
    stageSeedFromPassphrase,
    prepareShamir,
    confirmPendingShamir,
    discardStagedSeed,
  } = useSeed();
  usePageTitle("휴대폰에만 쓰기");

  const [existing, setExisting] = useState<boolean | null>(null);
  const [switching, setSwitching] = useState(false);

  const [nickname, setNickname] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step>("passphrase");
  const [shares, setShares] = useState<Uint8Array[]>([]);
  // Set once this page creates the keys, so "already set up → leave"
  // doesn't fire mid-setup when refresh() flips the seed to "locked".
  const [settingUp, setSettingUp] = useState(false);
  const local = account?.kind === "local";
  const alreadySetUp = local && !settingUp && (seedStatus === "locked" || seedStatus === "unlocked");

  useEffect(() => {
    if (!IS_ANDROID_APP || mode === "local") return;
    const id = existingLocalDiaryId();
    let cancelled = false;
    (id ? localDiaryExists(id) : Promise.resolve(false)).then((found) => {
      if (!cancelled) setExisting(found);
    });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    if (alreadySetUp) router.replace(DEFAULT_SIGNED_IN_PATH);
  }, [alreadySetUp, router]);

  // Leaving this page drops any seed staged for the backup-code step.
  useEffect(() => () => discardStagedSeed(), [discardStagedSeed]);

  function finish() {
    discardStagedSeed();
    router.replace(DEFAULT_SIGNED_IN_PATH);
  }

  async function switchToLocal() {
    setSwitching(true);
    await startLocalMode();
    setSwitching(false);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!store || store.kind !== "local") return;
    const name = normalizeNickname(nickname);
    if (name && nicknameProblem(name)) {
      setError(nicknameProblem(name));
      return;
    }
    if (passphrase !== passphraseConfirm) {
      setError("두 칸에 같은 일기 암호를 넣어 주세요.");
      return;
    }
    if (!checkPassphraseStrength(passphrase, name ? [name] : []).isStrongEnough) {
      setError("일기 암호가 너무 짧아요. 서로 상관없는 단어를 더 이어 붙여 보세요.");
      return;
    }
    setBusy(true);
    let created = false;
    try {
      const seed = generateMasterSeed();
      const { publicKeys, privateKeys } = deriveHybridKeyPair(seed);
      const wrapped = await wrapSeed(seed, passphrase);
      wipeBytes(seed, privateKeys.x25519SecretKey, privateKeys.mlkem768SecretKey);
      setSettingUp(true);
      await store.createKeyRecord(publicKeys, wrapped);
      created = true;
      if (name) await store.setNickname(name).catch(() => {});
      await refresh();
      await stageSeedFromPassphrase(passphrase);
      setPassphrase("");
      setPassphraseConfirm("");
      setStep("backup-intro");
    } catch (err) {
      console.error("creating the local diary failed", err);
      if (!created) {
        setSettingUp(false);
        setError("일기장을 만들지 못했어요. 다시 시도해 주세요.");
      } else {
        finish();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateBackupCodes() {
    setError(null);
    setBusy(true);
    try {
      setShares(await prepareShamir(LOCAL_SHARES.n, LOCAL_SHARES.k));
      setStep("backup-reveal");
    } catch (err) {
      console.error("prepareShamir failed", err);
      setError("백업 코드를 만들지 못했어요. 설정에서 다시 만들 수 있어요.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmBackupCodes() {
    setError(null);
    setBusy(true);
    try {
      await confirmPendingShamir();
      setShares([]);
      finish();
    } catch (err) {
      console.error("confirmPendingShamir failed", err);
      setError("백업 코드를 저장하지 못했어요. 방금 보인 코드는 쓸 수 없으니 설정에서 다시 만들어 주세요.");
    } finally {
      setBusy(false);
    }
  }

  if (!IS_ANDROID_APP) {
    return (
      <AuthShell title="휴대폰에만 쓰기" lead="Android 앱에서 쓸 수 있는 기능이에요.">
        <p className="muted">
          서버 없이 휴대폰 안에만 일기장을 두려면 Android 앱을 설치해 주세요.{" "}
          <Link href={docHref("/docs/android#local")} className="link whitespace-nowrap">
            자세히
          </Link>
        </p>
        <Link href="/login" className="btn-secondary w-full">
          로그인으로 돌아가기
        </Link>
      </AuthShell>
    );
  }

  if (mode !== "local") {
    if (existing === null) return <LoadingScreen />;
    return (
      <AuthShell
        title="서버 없이 이 휴대폰에만 쓰기"
        lead="계정을 만들지 않고, 일기장을 이 휴대폰 안에만 둬요."
      >
        <ul className="space-y-3 text-[0.9375rem] leading-relaxed">
          <li className="flex gap-3">
            <Icon name="lock" size={20} className="mt-0.5 shrink-0" />
            <span>일기는 일기 암호로 잠가서 이 휴대폰에만 저장해요. 계정 일기와는 섞이지 않아요.</span>
          </li>
          <li className="flex gap-3">
            <Icon name="shield" size={20} className="mt-0.5 shrink-0" />
            <span>이 방식을 쓰는 동안 앱은 인터넷에 전혀 연결하지 않아요. PrivateDiary 서버도 일기장이 있는지조차 몰라요.</span>
          </li>
          <li className="flex gap-3">
            <Icon name="alert" size={20} className="mt-0.5 shrink-0" />
            <span>
              다른 곳에 사본이 없어요. 휴대폰을 잃어버리거나 앱을 지우면 일기도 사라지니, 가끔 잠긴 파일로 내보내 두세요.
            </span>
          </li>
        </ul>
        {accountStatus === "signed-in" && account?.kind === "cloud" && (
          <p className="note-warn">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
            <span>지금 계정에서 로그아웃해요. 계정의 일기는 서버에 그대로 있어요.</span>
          </p>
        )}
        <button
          type="button"
          onClick={() => void switchToLocal()}
          disabled={switching}
          className="btn-primary min-h-14 w-full rounded-2xl text-[1.0625rem]"
        >
          {switching ? "바꾸는 중…" : existing ? "이 휴대폰의 일기장 열기" : "휴대폰 일기장 만들기"}
        </button>
        <Link href="/login" className="btn-text w-full">
          계정으로 로그인하기
        </Link>
      </AuthShell>
    );
  }

  if (!local || seedStatus === "unknown" || alreadySetUp) return <LoadingScreen />;

  if (step === "backup-reveal" && shares.length > 0) {
    return (
      <main className="flex flex-1 flex-col items-center px-5 pb-10 pt-6 sm:px-6 sm:py-16">
        <div className="w-full max-w-md space-y-3">
          <StepProgress step={3} />
          <SecretReveal
            title="백업 코드를 적어 두세요"
            description={`일기 암호를 잊어도 ${LOCAL_SHARES.n}개 중 ${LOCAL_SHARES.k}개만 있으면 일기장을 열 수 있어요. 휴대폰 밖, 서로 다른 곳에 나눠 두세요. 이 화면을 닫으면 다시 볼 수 없어요.`}
            confirmLabel={busy ? "저장하는 중…" : "첫 일기 쓰러 가기"}
            confirming={busy}
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
          {error && (
            <p role="alert" className="error-text">
              {error}
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
        lead="휴대폰 일기장은 일기 암호를 잊으면 누구도 대신 열어 줄 수 없어요. 백업 코드가 있으면 열 수 있어요."
      >
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => void handleCreateBackupCodes()}
            disabled={busy}
            className="btn-primary min-h-14 w-full rounded-2xl text-[1.0625rem]"
          >
            {busy ? "만드는 중…" : "백업 코드 만들기"}
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
          휴대폰 일기장을 여는 열쇠예요. 어디에도 저장하지 않아서, 잊으면 누구도 대신 찾아 줄 수 없어요.{" "}
          <Link href={docHref("/docs/passphrase")} className="link whitespace-nowrap">
            자세히
          </Link>
        </>
      }
      after={
        <button
          type="button"
          onClick={() => {
            leaveLocalMode();
            router.replace("/login");
          }}
          className="btn-text w-full"
        >
          계정으로 돌아가기
        </button>
      }
    >
      <form onSubmit={(event) => void handleCreate(event)} className="space-y-5">
        <TextField
          label="닉네임 (선택)"
          autoComplete="nickname"
          required={false}
          maxLength={NICKNAME_MAX_LENGTH}
          value={nickname}
          onChange={setNickname}
          hint="앱에서 부를 이름이에요. 이 휴대폰에만 저장해요."
        />
        <div className="space-y-2">
          <PasswordField label="일기 암호" autoComplete="passphrase" value={passphrase} onChange={setPassphrase} />
          <PassphraseStrengthMeter passphrase={passphrase} userInputs={nickname ? [nickname] : []} />
          <p className="text-[0.8125rem] leading-relaxed text-ink-3">
            서로 상관없는 단어 4개 정도를 띄어 쓰면 기억하기 쉽고 안전해요. 비밀번호 관리 앱도 이 암호는 기억하지 않아요.
          </p>
        </div>
        <PasswordField
          label="일기 암호 확인"
          autoComplete="passphrase"
          value={passphraseConfirm}
          onChange={setPassphraseConfirm}
        />
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="btn-primary min-h-14 w-full rounded-2xl text-[1.0625rem]">
          {busy ? "일기장을 만드는 중…" : "다음"}
        </button>
      </form>
    </AuthShell>
  );
}
