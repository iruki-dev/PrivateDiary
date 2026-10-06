"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useBiometricGate } from "@/contexts/BiometricGateContext";
import { BiometricGateError, haptic, resetBiometricGate } from "@/lib/native/app";
import { reauthenticateWithGoogle, reauthenticateWithPassword } from "@/lib/firebase/auth";
import { authErrorCode, isUserCancelledPopup } from "@/lib/firebase/authErrors";
import { LoadingState } from "@/components/LoadingState";
import { ReauthPanel } from "@/components/settings/forms";
import { Icon } from "@/components/Icon";

function gateMessage(code: string): string | null {
  switch (code) {
    case "cancelled":
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
 * Once `children` have been shown, they stay mounted (hidden and inert)
 * while the gate is up again, so leaving the app mid-way through a
 * settings step — copying a new backup code into a password manager —
 * doesn't throw that step away; it's simply behind the check again.
 */
export function BiometricGate({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const { user } = useAuth();
  const { loading, status, required, verify, refresh } = useBiometricGate();
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

  // The prompt opens by itself the first time the gate shows.
  useEffect(() => {
    if (!required || loading || unknown || invalidated || autoPromptedRef.current) return;
    autoPromptedRef.current = true;
    // Opening the system biometric prompt is the external effect here.
    void check();
    // check() is recreated every render; the ref guards re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [required, loading, unknown, invalidated]);

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

  if (!required) return content;
  if (loading) return <LoadingState />;

  const isGoogleAccount = user?.providerData.some((p) => p.providerId === "google.com") ?? false;

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
