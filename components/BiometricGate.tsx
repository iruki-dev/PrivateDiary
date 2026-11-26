"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAccount } from "@/contexts/AccountContext";
import { useAuth } from "@/contexts/AuthContext";
import { useBiometricGate } from "@/contexts/BiometricGateContext";
import { BiometricGateError, haptic, resetBiometricGate } from "@/lib/native/app";
import { onNativeEvent } from "@/lib/native/bridge";
import { reauthenticateWithGoogle, reauthenticateWithPassword } from "@/lib/firebase/auth";
import { authErrorCode, isUserCancelledPopup } from "@/lib/firebase/authErrors";
import { LoadingState } from "@/components/LoadingState";
import { ReauthPanel } from "@/components/settings/forms";
import { Icon } from "@/components/Icon";

function gateMessage(code: string): string | null {
  switch (code) {
    case "cancelled":
    // A prompt is already up (or waiting for the app to come back) — that
    // one answers; nothing went wrong.
    case "busy":
      return null;
    case "lockout":
      return "생체 인증을 여러 번 실패했어요. 잠시 뒤에 다시 해 주세요.";
    default:
      return "생체 인증을 확인하지 못했어요. 다시 시도해 주세요.";
  }
}

/**
 * The biometric check's gate (Android app), the twin of components/OtpGate:
 * renders `children` — the passphrase form, or the settings that need the
 * passphrase — only once the check has passed (contexts/BiometricGateContext).
 *
 * `footer` shows only while the gate is up: the caller's way around it
 * with the backup codes, exactly as OtpGate's footer.
 *
 * `hasBackupCodes` says whether this diary has backup codes. It only
 * matters for a local diary whose check was invalidated by a new
 * fingerprint or face: with codes, the codes are the only way in; without
 * any, the person may open it with the passphrase alone, since nothing
 * else could (contexts/BiometricGateContext).
 *
 * Once `children` have been shown, they stay mounted (hidden and inert)
 * while the gate is up again, so leaving the app mid-way through a
 * settings step — copying a new backup code into a password manager —
 * doesn't throw that step away; it's simply behind the check again.
 */
export function BiometricGate({
  children,
  footer,
  hasBackupCodes = false,
}: {
  children: ReactNode;
  footer?: ReactNode;
  hasBackupCodes?: boolean;
}) {
  const { user } = useAuth();
  const { account } = useAccount();
  const { loading, status, required, verify, refresh, degraded, stepAside, steppedAside } = useBiometricGate();
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [revealed, setRevealed] = useState(!required);
  const [reauthing, setReauthing] = useState(false);
  const [password, setPassword] = useState("");
  const autoPromptedRef = useRef(false);

  useEffect(() => {
    // Remembers that the protected content has been shown once (see doc
    // comment) — a one-way latch, not state derivable during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!required) setRevealed(true);
  }, [required]);

  const invalidated = status?.invalidated === true;
  const unknown = status === null;

  async function check() {
    setError(null);
    setChecking(true);
    try {
      await verify();
      haptic("confirm");
    } catch (err) {
      const code = err instanceof BiometricGateError ? err.code : "failed";
      if (code === "invalidated") await refresh();
      setError(gateMessage(code));
    } finally {
      setChecking(false);
    }
  }

  // The prompt opens by itself each time the gate goes up (the diary
  // locked), and again when the person comes back to the app with the gate
  // still up. A request made while the app is in the background waits in
  // the app until it is back on screen (android/.../BiometricGate.kt).
  useEffect(() => {
    if (!required) {
      autoPromptedRef.current = false;
      return;
    }
    if (loading || unknown || invalidated || autoPromptedRef.current) return;
    autoPromptedRef.current = true;
    // Opening the system biometric prompt is the external effect here.
    void check();
    // check() is recreated every render; the ref guards re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [required, loading, unknown, invalidated]);

  // Read by the lifecycle listener below, which is registered once.
  const latestRef = useRef({ promptable: false, checking: false, check });
  useEffect(() => {
    latestRef.current = { promptable: required && !loading && !unknown && !invalidated, checking, check };
  });
  useEffect(
    () =>
      onNativeEvent("lifecycle", (data) => {
        // Only a real return (time away), never the app's own prompt closing.
        const returned = data.state === "foreground" && typeof data.awayMs === "number" && data.awayMs > 0;
        const latest = latestRef.current;
        if (returned && latest.promptable && !latest.checking) void latest.check();
      }),
    []
  );

  async function afterReauth() {
    if (!user) return;
    await resetBiometricGate(user.uid);
    await refresh();
    setReauthing(false);
    setPassword("");
  }

  async function handleReauthPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setChecking(true);
    setError(null);
    try {
      await reauthenticateWithPassword(user, password);
      await afterReauth();
    } catch (err) {
      const code = authErrorCode(err);
      setError(
        code === "auth/invalid-credential" || code === "auth/wrong-password"
          ? "로그인 비밀번호를 다시 확인해 주세요."
          : "본인을 확인하지 못했어요. 다시 시도해 주세요."
      );
    } finally {
      setChecking(false);
    }
  }

  async function handleReauthGoogle() {
    if (!user) return;
    setChecking(true);
    setError(null);
    try {
      await reauthenticateWithGoogle(user);
      await afterReauth();
    } catch (err) {
      if (!isUserCancelledPopup(err)) setError("본인을 확인하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setChecking(false);
    }
  }

  const content = revealed ? (
    <div hidden={required} inert={required || undefined} className={required ? undefined : "contents"}>
      {children}
    </div>
  ) : null;

  if (steppedAside && !required) {
    return (
      <>
        <p className="note-warn w-full">
          <Icon name="fingerprint" size={18} className="mt-0.5 shrink-0" />
          <span>
            생체 인증 없이 일기 암호만으로 열어요. 열고 나면 생체 인증이 꺼지니, 백업 코드를 만든 뒤 설정에서 다시 켜 주세요.
          </span>
        </p>
        {content}
      </>
    );
  }
  if (!required) return content;
  if (loading) return <LoadingState />;

  const isGoogleAccount = user?.providerData.some((p) => p.providerId === "google.com") ?? false;
  const localWithoutCodes = degraded && account?.kind === "local" && !hasBackupCodes;

  if (degraded) {
    // No login to re-prove (a local diary, or the phone's copy): the backup
    // codes — the caller's footer — are the way in, never the passphrase alone.
    return (
      <>
        {content}
        <div className="w-full space-y-2">
          <div className="card space-y-5">
            <div className="flex gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary">
                <Icon name="fingerprint" size={22} />
              </span>
              <div className="space-y-0.5">
                <h2 className="text-[1.0625rem] font-bold">생체 정보가 바뀌었어요</h2>
                <p className="muted text-sm">
                  {account?.kind === "backup"
                    ? "휴대폰에 새 지문이나 얼굴이 등록됐어요. 이 백업은 이제 백업 코드로만 열 수 있어요. 인터넷이 될 때 계정에 로그인하면 생체 인증을 다시 설정할 수 있어요."
                    : localWithoutCodes
                      ? "휴대폰에 새 지문이나 얼굴이 등록됐어요. 이 일기장은 백업 코드가 없어서 일기 암호만으로 열 수 있어요. 휴대폰 잠금과 일기 암호를 아는 사람도 열 수 있게 되니, 연 뒤에 백업 코드를 만들어 주세요."
                      : "휴대폰에 새 지문이나 얼굴이 등록됐어요. 이 일기장은 이제 백업 코드로만 열 수 있어요. 열고 나면 설정에서 생체 인증을 다시 켤 수 있어요."}
                </p>
              </div>
            </div>
            {localWithoutCodes && (
              <button type="button" onClick={stepAside} className="btn-primary min-h-14 w-full rounded-2xl text-[1.0625rem]">
                일기 암호로 열기
              </button>
            )}
          </div>
          {footer}
        </div>
      </>
    );
  }

  return (
    <>
      {content}
      <div className="w-full space-y-2">
        <div className="card space-y-5">
          <div className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary">
              <Icon name="fingerprint" size={22} />
            </span>
            <div className="space-y-0.5">
              <h2 className="text-[1.0625rem] font-bold">{invalidated ? "생체 정보가 바뀌었어요" : "생체 인증"}</h2>
              <p className="muted text-sm">
                {invalidated
                  ? "휴대폰에 새 지문이나 얼굴이 등록됐어요. 로그인 비밀번호로 본인을 확인하면 다시 설정할 수 있어요."
                  : unknown
                    ? "생체 인증 상태를 확인하지 못했어요. 다시 시도해 주세요."
                    : "일기 암호를 넣기 전에 지문이나 얼굴로 먼저 확인해요."}
              </p>
            </div>
          </div>

          {invalidated ? (
            reauthing ? (
              <ReauthPanel
                reason="생체 인증을 다시 설정하려면 로그인한 계정으로 본인을 확인해 주세요."
                isGoogleAccount={isGoogleAccount}
                password={password}
                onPasswordChange={setPassword}
                onSubmitPassword={(event) => void handleReauthPassword(event)}
                onGoogle={() => void handleReauthGoogle()}
                busy={checking}
                error={error}
                onCancel={() => {
                  setReauthing(false);
                  setPassword("");
                  setError(null);
                }}
              />
            ) : (
              <button type="button" onClick={() => setReauthing(true)} className="btn-primary min-h-14 w-full rounded-2xl text-[1.0625rem]">
                로그인 비밀번호로 확인하기
              </button>
            )
          ) : (
            <>
              {error && (
                <p role="alert" className="error-text">
                  {error}
                </p>
              )}
              <button
                type="button"
                onClick={() => void (unknown ? refresh() : check())}
                disabled={checking}
                className="btn-primary min-h-14 w-full rounded-2xl text-[1.0625rem]"
              >
                {!checking && !unknown && <Icon name="fingerprint" size={22} />}
                {checking ? "확인하는 중…" : unknown ? "다시 시도" : "생체 인증하기"}
              </button>
            </>
          )}
        </div>
        {footer}
      </div>
    </>
  );
}
