"use client";

import { useId, type FormEvent, type ReactNode } from "react";
import { PasswordField } from "@/components/PasswordField";

/**
 * Pieces every /settings flow repeats: proving a master credential
 * (passphrase or K backup codes), re-confirming the login, and the
 * submit/cancel pair. Previously each section carried its own copy of
 * these, styled slightly differently each time.
 */

export type CredentialMode = "passphrase" | "shamir";

/**
 * "일기 암호" or "백업 코드" proof. The backup-code option only appears
 * when the account has backup codes (`shamirK` is their threshold).
 */
export function CredentialProof({
  mode,
  onModeChange,
  shamirK,
  passphrase,
  onPassphraseChange,
  shares,
  onSharesChange,
  autoFocus = true,
}: {
  mode: CredentialMode;
  onModeChange: (mode: CredentialMode) => void;
  shamirK: number | null;
  passphrase: string;
  onPassphraseChange: (value: string) => void;
  shares: string[];
  onSharesChange: (shares: string[]) => void;
  autoFocus?: boolean;
}) {
  const groupId = useId();
  return (
    <div className="space-y-3">
      {shamirK !== null && (
        <div
          role="radiogroup"
          aria-label="본인 확인 방법"
          className="grid grid-cols-2 rounded border border-zinc-300 p-0.5 text-sm dark:border-zinc-700"
        >
          {(
            [
              ["passphrase", "일기 암호"],
              ["shamir", "백업 코드"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => onModeChange(value)}
              className={`min-h-9 rounded-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/50 ${
                mode === value
                  ? "bg-foreground font-medium text-background"
                  : "text-zinc-600 hover:text-foreground dark:text-zinc-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {mode === "passphrase" || shamirK === null ? (
        <PasswordField
          label="일기 암호"
          autoComplete="current-password"
          autoFocus={autoFocus}
          value={passphrase}
          onChange={onPassphraseChange}
        />
      ) : (
        <fieldset className="space-y-2">
          <legend className="field-label">백업 코드 {shamirK}개</legend>
          {shares.map((value, i) => (
            <input
              key={i}
              id={`${groupId}-${i}`}
              type="text"
              required
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label={`백업 코드 ${i + 1}`}
              value={value}
              onChange={(e) => onSharesChange(shares.map((v, idx) => (idx === i ? e.target.value : v)))}
              placeholder={`코드 ${i + 1}`}
              className="field-mono"
            />
          ))}
        </fieldset>
      )}
    </div>
  );
}

/** Submit + cancel, side by side. */
export function PanelActions({
  submitLabel,
  busyLabel = "확인 중...",
  busy,
  onCancel,
  tone = "primary",
}: {
  submitLabel: string;
  busyLabel?: string;
  busy: boolean;
  onCancel: () => void;
  tone?: "primary" | "danger";
}) {
  return (
    <div className="flex gap-2 pt-1">
      <button type="submit" disabled={busy} className={`${tone === "danger" ? "btn-danger" : "btn-primary"} flex-1`}>
        {busy ? busyLabel : submitLabel}
      </button>
      <button type="button" onClick={onCancel} className="btn-secondary">
        취소
      </button>
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="error-text">
      {children}
    </p>
  );
}

/**
 * Re-confirm the LOGIN credential when the server needs a recent sign-in
 * (functions' requireRecentAuth). Password accounts re-enter the login
 * password; Google accounts redo the popup.
 */
export function ReauthPanel({
  reason,
  isGoogleAccount,
  password,
  onPasswordChange,
  onSubmitPassword,
  onGoogle,
  busy,
  error,
  onCancel,
  tone = "primary",
}: {
  reason: string;
  isGoogleAccount: boolean;
  password: string;
  onPasswordChange: (value: string) => void;
  onSubmitPassword: (event: FormEvent<HTMLFormElement>) => void;
  onGoogle: () => void;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  tone?: "primary" | "danger";
}) {
  return (
    <div className="space-y-3">
      <p className="muted">{reason}</p>
      <FormError>{error}</FormError>
      {isGoogleAccount ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onGoogle}
            className={`${tone === "danger" ? "btn-danger" : "btn-primary"} flex-1`}
          >
            {busy ? "확인 중..." : "Google로 다시 로그인"}
          </button>
          <button type="button" onClick={onCancel} className="btn-secondary">
            취소
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmitPassword} className="space-y-3">
          <PasswordField
            label="로그인 비밀번호"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={onPasswordChange}
          />
          <PanelActions submitLabel="다시 로그인" busy={busy} onCancel={onCancel} tone={tone} />
        </form>
      )}
    </div>
  );
}

/** Shared copy for credential-proof failures. */
export const CREDENTIAL_ERRORS = {
  wrongPassphrase: "일기 암호가 올바르지 않습니다.",
  wrongShares: "백업 코드가 올바르지 않습니다. 코드를 다시 확인해주세요.",
  recentLogin: "보안 설정을 바꾸려면 최근에 로그인한 상태여야 합니다. 로그아웃 후 다시 로그인해주세요.",
} as const;
