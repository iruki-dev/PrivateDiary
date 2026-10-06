"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useBiometricGate } from "@/contexts/BiometricGateContext";
import {
  disableBiometricGate,
  enableBiometricGate,
  haptic,
  resetBiometricGate,
  type BiometricGateStatus,
} from "@/lib/native/app";
import { NativeError } from "@/lib/native/bridge";
import { reauthenticateWithGoogle, reauthenticateWithPassword } from "@/lib/firebase/auth";
import { authErrorCode, isUserCancelledPopup } from "@/lib/firebase/authErrors";
import { SettingsRow, Switch } from "./ui";
import { ReauthPanel } from "./forms";

function describe(status: BiometricGateStatus): string {
  if (status.invalidated) {
    return "휴대폰에 새 지문이나 얼굴이 등록됐어요. 로그인 비밀번호로 본인을 확인하면 다시 설정할 수 있어요.";
  }
  if (status.enabled) {
    return "2단계 인증처럼, 일기 암호를 넣기 전에 지문이나 얼굴로 먼저 확인해요. 백업 코드로는 바로 열 수 있어요. 이 휴대폰에서만 적용돼요.";
  }
  switch (status.availability) {
    case "ready":
      return "2단계 인증처럼, 일기 암호를 넣기 전에 지문이나 얼굴로 먼저 확인해요. 일기 암호를 대신하지는 않아요.";
    case "no-device-lock":
      return "휴대폰에 화면 잠금을 먼저 설정하면 쓸 수 있어요.";
    case "none-enrolled":
      return "휴대폰 설정에서 지문이나 얼굴을 먼저 등록하면 쓸 수 있어요.";
    default:
      return "이 휴대폰에서는 쓸 수 없어요. 보안 등급이 높은 생체 인증이 필요해요.";
  }
}

function gateErrorMessage(err: unknown): string | null {
  const code = err instanceof NativeError ? err.code : "failed";
  if (code === "cancelled") return null;
  if (code === "lockout") return "생체 인증을 여러 번 실패했어요. 잠시 뒤에 다시 해 주세요.";
  if (code === "insecure-hardware") return "이 휴대폰은 보안 하드웨어에 키를 만들 수 없어서 켤 수 없어요.";
  if (code === "invalidated") return "생체 정보가 바뀌어서 확인할 수 없어요. 다시 설정해 주세요.";
  return "생체 인증을 확인하지 못했어요. 다시 시도해 주세요.";
}

/**
 * "생체 인증" (Android app only) — on the same footing as OTP: a check in
 * front of the diary passphrase, never a replacement for it
 * (components/BiometricGate). Turning it on needs one passing check;
 * turning it off needs one too. If a new
 * fingerprint or face invalidates it, the diary stays closed until the
 * person re-proves the login and sets it up again
 * (android/.../BiometricGate.kt).
 */
export function BiometricGateRow() {
  const { user } = useAuth();
  const { status, refresh, markPassed } = useBiometricGate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reauthing, setReauthing] = useState(false);
  const [password, setPassword] = useState("");
  const isGoogleAccount = user?.providerData.some((p) => p.providerId === "google.com") ?? false;

  if (!status || !user) return null;
  const signedInUser = user;

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      haptic("confirm");
      setMessage(done);
    } catch (err) {
      setError(gateErrorMessage(err));
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  async function afterReauth() {
    await resetBiometricGate(signedInUser.uid);
    await refresh();
    setReauthing(false);
    setPassword("");
    setMessage("생체 인증을 초기화했어요. 다시 켤 수 있어요.");
  }

  async function handleReauthPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await reauthenticateWithPassword(signedInUser, password);
      await afterReauth();
    } catch (err) {
      const code = authErrorCode(err);
      setError(
        code === "auth/invalid-credential" || code === "auth/wrong-password"
          ? "로그인 비밀번호를 다시 확인해 주세요."
          : "본인을 확인하지 못했어요. 다시 시도해 주세요."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleReauthGoogle() {
    setBusy(true);
    setError(null);
    try {
      await reauthenticateWithGoogle(signedInUser);
      await afterReauth();
    } catch (err) {
      if (!isUserCancelledPopup(err)) setError("본인을 확인하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  const available = status.enabled || status.availability === "ready";

  return (
    <SettingsRow
      label="생체 인증"
      description={
        <>
          <span className={status.invalidated ? "text-danger" : ""}>
            {status.invalidated ? "다시 설정해야 해요" : status.enabled ? "켜짐" : "꺼짐"}
          </span>
          {" · "}
          {describe(status)}
          {message && <span className="mt-1 block text-ink">{message}</span>}
        </>
      }
      control={
        status.invalidated ? (
          !reauthing && (
            <button type="button" onClick={() => setReauthing(true)} className="btn-secondary btn-sm">
              다시 설정
            </button>
          )
        ) : (
          <Switch
            label="생체 인증"
            checked={status.enabled}
            disabled={!available || busy}
            onChange={(next) =>
              void (next
                ? run(async () => {
                    await enableBiometricGate(signedInUser.uid);
                    // Turning it on passed one check already.
                    markPassed();
                  }, "켰어요")
                : run(() => disableBiometricGate(signedInUser.uid), "껐어요"))
            }
          />
        )
      }
    >
      {reauthing ? (
        <ReauthPanel
          reason="생체 인증을 다시 설정하려면 로그인한 계정으로 본인을 확인해 주세요."
          isGoogleAccount={isGoogleAccount}
          password={password}
          onPasswordChange={setPassword}
          onSubmitPassword={(event) => void handleReauthPassword(event)}
          onGoogle={() => void handleReauthGoogle()}
          busy={busy}
          error={error}
          onCancel={() => {
            setReauthing(false);
            setPassword("");
            setError(null);
          }}
        />
      ) : (
        error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )
      )}
    </SettingsRow>
  );
}
