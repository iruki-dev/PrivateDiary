"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSeed } from "@/contexts/SeedContext";
import { useDeviceUnlock } from "@/hooks/useDeviceUnlock";
import { forgetDeviceUnlock, haptic, type DeviceUnlockStatus } from "@/lib/native/app";
import { NativeError } from "@/lib/native/bridge";
import { InvalidShamirSharesError, WrongPassphraseError, textToRecoverySecret } from "@/lib/crypto";
import { SettingsRow, Switch } from "./ui";
import { CREDENTIAL_ERRORS, CredentialProof, FormError, PanelActions, type CredentialMode } from "./forms";

function describe(status: DeviceUnlockStatus): string {
  if (status.enrolled) {
    return status.hardware === "strongbox"
      ? "열쇠는 이 휴대폰의 보안 칩 안에만 있습니다. 새 지문이나 얼굴이 등록되면 자동으로 꺼집니다."
      : "열쇠는 이 휴대폰의 보안 영역 안에만 있습니다. 새 지문이나 얼굴이 등록되면 자동으로 꺼집니다.";
  }
  switch (status.availability) {
    case "ready":
      return "일기 암호 대신 지문이나 얼굴로 지난 일기를 엽니다. 이 휴대폰에서만 쓰입니다.";
    case "no-device-lock":
      return "휴대폰에 화면 잠금을 먼저 설정해야 쓸 수 있습니다.";
    case "none-enrolled":
      return "휴대폰 설정에서 지문이나 얼굴을 먼저 등록해야 쓸 수 있습니다.";
    default:
      return "이 휴대폰에서는 쓸 수 없습니다. 보안 등급이 높은 생체 인증이 필요합니다.";
  }
}

function enrollErrorMessage(err: unknown): string | null {
  if (err instanceof WrongPassphraseError) return CREDENTIAL_ERRORS.wrongPassphrase;
  if (err instanceof InvalidShamirSharesError) return CREDENTIAL_ERRORS.wrongShares;
  if (err instanceof NativeError) {
    if (err.code === "cancelled") return null;
    if (err.code === "lockout") return "인증 시도가 너무 많았습니다. 잠시 뒤에 다시 시도해주세요.";
    if (err.code === "insecure-hardware") return "이 휴대폰은 열쇠를 보안 하드웨어에 보관할 수 없어 켤 수 없습니다.";
  }
  return "켜지 못했습니다. 다시 시도해주세요.";
}

/**
 * "생체 인증으로 열기" (Android app only). Turning it on needs the diary
 * passphrase (or backup codes) once, because that's what produces the
 * seed the phone then keeps wrapped in its secure hardware
 * (android/.../BiometricVault.kt). Turning it off needs nothing — it only
 * ever makes the phone hold less.
 */
export function DeviceUnlockRow({ shamirK }: { shamirK: number | null }) {
  const { user } = useAuth();
  const { stageSeedFromPassphrase, stageSeedFromShamirShares, discardStagedSeed, enrollDeviceUnlock } = useSeed();
  const { status, refresh } = useDeviceUnlock();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CredentialMode>("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [shares, setShares] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => discardStagedSeed(), [discardStagedSeed]);

  if (!status) return null;

  function start() {
    setError(null);
    setMessage(null);
    setMode("passphrase");
    setPassphrase("");
    setShares(Array(shamirK ?? 0).fill(""));
    setOpen(true);
  }

  function cancel() {
    discardStagedSeed();
    setOpen(false);
    setPassphrase("");
    setError(null);
  }

  async function turnOff() {
    if (!user) return;
    setBusy(true);
    setMessage(null);
    try {
      await forgetDeviceUnlock(user.uid);
      await refresh();
      setMessage("껐습니다. 이 휴대폰에서 열쇠를 지웠습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "passphrase") {
        await stageSeedFromPassphrase(passphrase);
        setPassphrase("");
      } else {
        await stageSeedFromShamirShares(shares.map((s) => textToRecoverySecret(s)));
      }
      // Shows the system biometric prompt; the staged seed is discarded
      // whatever happens (contexts/SeedContext.tsx).
      await enrollDeviceUnlock();
      haptic("confirm");
      await refresh();
      setOpen(false);
      setMessage("켰습니다.");
    } catch (err) {
      setError(enrollErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const available = status.enrolled || status.availability === "ready";

  return (
    <SettingsRow
      label="생체 인증으로 열기"
      description={
        <>
          {describe(status)}
          {message && <span className="mt-1 block text-foreground">{message}</span>}
        </>
      }
      control={
        <Switch
          label="생체 인증으로 열기"
          checked={status.enrolled || open}
          disabled={!available || busy}
          onChange={(next) => (next ? start() : open ? cancel() : void turnOff())}
        />
      }
    >
      {open && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <p className="muted text-xs leading-relaxed">
            처음 한 번만 일기 암호로 본인을 확인합니다. 그다음 지문이나 얼굴을 인식하면 켜집니다.
          </p>
          <CredentialProof
            mode={mode}
            onModeChange={setMode}
            shamirK={shamirK}
            passphrase={passphrase}
            onPassphraseChange={setPassphrase}
            shares={shares}
            onSharesChange={setShares}
          />
          <FormError>{error}</FormError>
          <PanelActions submitLabel="다음" busyLabel="확인 중..." busy={busy} onCancel={cancel} />
        </form>
      )}
    </SettingsRow>
  );
}
