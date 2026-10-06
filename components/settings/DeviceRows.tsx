"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "@/contexts/AccountContext";
import { useNative } from "@/contexts/NativeContext";
import { useSeed } from "@/contexts/SeedContext";
import { deleteBackup, getBackupSummary, mergeBackupEntries, startBackup, type BackupSummary } from "@/lib/store/backup";
import { deleteLocalDiary } from "@/lib/store/local";
import { entryRecordFromStored, keyRecordToStorage } from "@/lib/store/records";
import { forgetLocalDiaryId } from "@/lib/deviceMode";
import { clearAllDrafts } from "@/lib/drafts";
import { loginIdFromEmail } from "@/lib/loginId";
import { haptic, resetBiometricGate } from "@/lib/native/app";
import { InvalidShamirSharesError, textToRecoverySecret, WrongPassphraseError } from "@/lib/crypto";
import { docHref } from "@/lib/site";
import { TextField } from "@/components/PasswordField";
import { MoreLink, SettingsRow, Switch } from "./ui";
import { CREDENTIAL_ERRORS, CredentialProof, FormError, PanelActions, type CredentialMode } from "./forms";

const backupTime = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });

/**
 * "이 휴대폰에 백업하기" (Android app, accounts): keeps a copy of the
 * account's diary on the phone — the same encrypted entries and wrapped
 * seeds the server holds — for when the server can't be reached or has
 * lost something (lib/store/backup.ts). Switched on per account, on this
 * phone only; switching it off erases the copy. The account itself is
 * untouched either way.
 */
export function PhoneBackupRow() {
  const router = useRouter();
  const { account, store, openBackup } = useAccount();
  const [summary, setSummary] = useState<BackupSummary | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = account?.kind === "cloud" ? account.id : null;

  const reload = useCallback(async () => {
    if (!uid) return;
    setSummary(await getBackupSummary(uid).catch(() => null));
  }, [uid]);

  useEffect(() => {
    // Reading the phone's storage is the external effect here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  if (!uid || !store || account?.kind !== "cloud" || summary === undefined) return null;
  const user = account.user;
  const label = loginIdFromEmail(user.email) ?? user.email ?? "Google 계정";

  async function turnOn() {
    if (!store || !uid) return;
    setBusy(true);
    setError(null);
    try {
      const record = await store.getKeyRecord();
      if (!record) throw new Error("No key record to back up");
      await startBackup(uid, label, keyRecordToStorage(record));
      // The first copy: everything the server has now. After this, reading
      // and writing the diary keeps it current (lib/store/cloud.ts).
      const list = await store.listEntries();
      await mergeBackupEntries(
        uid,
        list.entries.map(entryRecordFromStored).filter((entry) => entry !== null),
        null
      );
      haptic("confirm");
    } catch (err) {
      console.error("starting the phone backup failed", err);
      await deleteBackup(uid).catch(() => {});
      setError("백업하지 못했어요. 인터넷 연결을 확인하고 다시 켜 주세요.");
    } finally {
      await reload();
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!uid) return;
    setBusy(true);
    setError(null);
    try {
      await deleteBackup(uid);
    } catch (err) {
      console.error("deleting the phone backup failed", err);
      setError("백업을 지우지 못했어요. 다시 시도해 주세요.");
    } finally {
      await reload();
      setBusy(false);
    }
  }

  return (
    <SettingsRow
      label="이 휴대폰에 백업하기"
      description={
        summary ? (
          <>
            일기 {summary.entryCount.toLocaleString("ko-KR")}개 · {backupTime.format(summary.updatedAt)}에 백업했어요. 서버에
            연결할 수 없을 때 로그인 화면에서 열 수 있어요. <MoreLink href={docHref("/docs/android#backup")} />
          </>
        ) : (
          <>
            서버에 문제가 생겨도 이 휴대폰에서 일기를 읽을 수 있게 잠긴 사본을 둬요. 일기 암호가 있어야 열려요.{" "}
            <MoreLink href={docHref("/docs/android#backup")} />
          </>
        )
      }
      control={
        <Switch
          label="이 휴대폰에 백업하기"
          checked={summary !== null}
          disabled={busy}
          onChange={(next) => void (next ? turnOn() : turnOff())}
        />
      }
    >
      {summary && (
        <button
          type="button"
          onClick={() => {
            openBackup(uid, summary.label);
            router.push("/entries");
          }}
          className="btn-secondary btn-sm"
        >
          백업 열어 보기
        </button>
      )}
      {summary && (
        <p className="text-[0.8125rem] leading-relaxed text-ink-3">
          2단계 인증은 서버에서 확인하는 거라 휴대폰에 있는 사본은 지키지 못해요. 사본은 일기 암호(또는 백업 코드)와
          생체 인증으로 열려요.
        </p>
      )}
      <FormError>{error}</FormError>
    </SettingsRow>
  );
}

/**
 * Switching this phone to the fully local diary (lib/deviceMode.ts): signs
 * out of the account first — the account and its diary stay on the server
 * exactly as they are — and cuts the app off from the network.
 */
export function LocalModeRow() {
  const router = useRouter();
  const { startLocalMode } = useAccount();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function switchToLocal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    await startLocalMode();
    router.replace("/local");
  }

  return (
    <SettingsRow
      label="서버 없이 이 휴대폰에만 쓰기"
      description={
        <>
          계정 없이, 인터넷을 끊은 채 이 휴대폰에만 있는 일기장을 써요. <MoreLink href={docHref("/docs/android#local")} />
        </>
      }
      control={
        !confirming && (
          <button type="button" onClick={() => setConfirming(true)} className="btn-secondary btn-sm">
            바꾸기
          </button>
        )
      }
    >
      {confirming && (
        <form onSubmit={(event) => void switchToLocal(event)} className="space-y-3">
          <p className="font-semibold">로그아웃하고 바꿀까요?</p>
          <p className="muted text-sm">
            계정의 일기는 서버에 그대로 있어요. 계정 일기를 휴대폰 일기장으로 옮기려면 먼저 잠긴 파일로 내보낸 뒤, 바꾼
            다음 불러오세요.
          </p>
          <PanelActions submitLabel="바꾸기" busyLabel="바꾸는 중…" busy={busy} onCancel={() => setConfirming(false)} />
        </form>
      )}
    </SettingsRow>
  );
}

/** Fully local mode: the app's network block, as the app reports it. */
export function NetworkBlockRow() {
  const { hello } = useNative();
  if (!hello) return null;
  return (
    <SettingsRow
      label="인터넷 연결"
      description={
        hello.networkBlocked
          ? "끊었어요. 이 앱은 지금 어떤 서버에도 연결하지 않아요."
          : "앱을 다시 열면 끊어요."
      }
    />
  );
}

/** Back to accounts. The local diary stays on the phone for next time. */
export function LeaveLocalModeRow() {
  const router = useRouter();
  const { leaveLocalMode } = useAccount();
  return (
    <SettingsRow
      label="계정으로 돌아가기"
      description="이 휴대폰의 일기장은 그대로 남아요. 로그인 화면에서 언제든 다시 열 수 있어요."
      control={
        <button
          type="button"
          onClick={() => {
            leaveLocalMode();
            router.replace("/login");
          }}
          className="btn-secondary btn-sm"
        >
          돌아가기
        </button>
      }
    />
  );
}

const ERASE_CONFIRM_PHRASE = "일기장을 지웁니다";

type ErasePhase = "status" | "credential" | "confirm";

/**
 * Erases the local diary from this phone — there is no other copy, so,
 * like deleting an account (app/settings/page.tsx's DeleteAccountRow), it
 * takes the passphrase or the backup codes first and then a typed
 * confirmation.
 */
export function EraseLocalDiaryRow() {
  const router = useRouter();
  const { account, leaveLocalMode } = useAccount();
  const { decryptionMethods, stageSeedFromPassphrase, stageSeedFromShamirShares, discardStagedSeed } = useSeed();
  const shamirConfig = decryptionMethods?.shamir ?? null;
  const [phase, setPhase] = useState<ErasePhase>("status");
  const [mode, setMode] = useState<CredentialMode>("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [shares, setShares] = useState<string[]>(shamirConfig ? Array(shamirConfig.k).fill("") : []);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => discardStagedSeed(), [discardStagedSeed]);

  if (account?.kind !== "local") return null;
  const id = account.id;

  function cancel() {
    discardStagedSeed();
    setPhase("status");
    setMode("passphrase");
    setPassphrase("");
    setShares(shamirConfig ? Array(shamirConfig.k).fill("") : []);
    setConfirmPhrase("");
    setError(null);
  }

  async function prove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "passphrase") await stageSeedFromPassphrase(passphrase);
      else await stageSeedFromShamirShares(shares.map((share) => textToRecoverySecret(share)));
      discardStagedSeed();
      setPassphrase("");
      setPhase("confirm");
    } catch (err) {
      setError(
        err instanceof WrongPassphraseError
          ? CREDENTIAL_ERRORS.wrongPassphrase
          : err instanceof InvalidShamirSharesError
            ? CREDENTIAL_ERRORS.wrongShares
            : "본인을 확인하지 못했어요."
      );
    } finally {
      setBusy(false);
    }
  }

  async function erase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmPhrase !== ERASE_CONFIRM_PHRASE) {
      setError(`“${ERASE_CONFIRM_PHRASE}”를 똑같이 입력해 주세요.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteLocalDiary(id);
      await resetBiometricGate(id).catch(() => {});
      clearAllDrafts();
      forgetLocalDiaryId();
      leaveLocalMode();
      router.replace("/login");
    } catch (err) {
      console.error("erasing the local diary failed", err);
      setError("일기장을 지우지 못했어요. 다시 시도해 주세요.");
      setBusy(false);
    }
  }

  return (
    <SettingsRow
      label="이 휴대폰의 일기장 지우기"
      tone="danger"
      description="다른 곳에 사본이 없어서 되돌릴 수 없어요"
      control={
        phase === "status" && (
          <button type="button" onClick={() => setPhase("credential")} className="btn-danger-outline btn-sm">
            지우기
          </button>
        )
      }
    >
      {phase === "credential" && (
        <form onSubmit={(event) => void prove(event)} className="space-y-4">
          <p className="muted">남기고 싶은 일기는 먼저 일기장에서 내보내 두세요. 계속하려면 본인인지 확인할게요.</p>
          <CredentialProof
            mode={mode}
            onModeChange={setMode}
            shamirK={shamirConfig?.k ?? null}
            passphrase={passphrase}
            onPassphraseChange={setPassphrase}
            shares={shares}
            onSharesChange={setShares}
          />
          <FormError>{error}</FormError>
          <PanelActions submitLabel="다음" busy={busy} onCancel={cancel} tone="danger" />
        </form>
      )}
      {phase === "confirm" && (
        <form onSubmit={(event) => void erase(event)} className="space-y-4">
          <TextField
            label={`확인을 위해 “${ERASE_CONFIRM_PHRASE}”를 입력해 주세요`}
            autoFocus
            autoComplete="off"
            value={confirmPhrase}
            onChange={setConfirmPhrase}
            placeholder={ERASE_CONFIRM_PHRASE}
          />
          <FormError>{error}</FormError>
          <PanelActions submitLabel="지우기" busyLabel="지우는 중…" busy={busy} onCancel={cancel} tone="danger" />
        </form>
      )}
    </SettingsRow>
  );
}
