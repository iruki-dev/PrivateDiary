/**
 * Id sign-in, server side — MUST match lib/loginId.ts in the web app (the
 * two packages don't share modules, same convention as
 * REAUTH_REQUIRED_MESSAGE in authFreshness.ts).
 *
 * An id "diary_kim" is the Firebase Auth email
 * "diary_kim@id.privatediary.invalid": a reserved domain that can never
 * receive mail. A real address is kept only as the account's optional
 * password-reset email (accountRecovery/{uid}).
 *
 * Pure: no firebase-admin import, so it unit-tests without an emulator.
 */

export const LOGIN_ID_EMAIL_DOMAIN = "id.privatediary.invalid";
const LOGIN_ID_PATTERN = /^[a-z0-9_]{4,20}$/;

/** The normalized id in `data.loginId`, or null if there isn't a valid one. */
export function parseLoginId(data: unknown): string | null {
  const raw = (data as { loginId?: unknown } | null)?.loginId;
  if (typeof raw !== "string") return null;
  const id = raw.trim().toLowerCase();
  return LOGIN_ID_PATTERN.test(id) ? id : null;
}

export function loginIdToEmail(id: string): string {
  return `${id}@${LOGIN_ID_EMAIL_DOMAIN}`;
}

export function loginIdFromEmail(email: string | undefined): string | null {
  if (!email) return null;
  const suffix = `@${LOGIN_ID_EMAIL_DOMAIN}`;
  if (!email.toLowerCase().endsWith(suffix)) return null;
  const id = email.slice(0, -suffix.length).toLowerCase();
  return LOGIN_ID_PATTERN.test(id) ? id : null;
}

export type RecoveryEmailInput = { kind: "set"; email: string } | { kind: "clear" } | { kind: "invalid" };

/** `data.email`: a plausible address to set, null to remove, anything else invalid. */
export function parseRecoveryEmail(data: unknown): RecoveryEmailInput {
  const raw = (data as { email?: unknown } | null)?.email;
  if (raw === null) return { kind: "clear" };
  if (typeof raw !== "string") return { kind: "invalid" };
  const email = raw.trim();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.toLowerCase().endsWith(`@${LOGIN_ID_EMAIL_DOMAIN}`)
  ) {
    return { kind: "invalid" };
  }
  return { kind: "set", email };
}

/** One reset mail per account per this long — enough for a retry, too slow to flood an inbox. */
export const RESET_MAIL_INTERVAL_MS = 2 * 60 * 1000;

export function mayResendResetMail(lastSentAtMs: number | null, nowMs: number): boolean {
  return lastSentAtMs === null || nowMs - lastSentAtMs >= RESET_MAIL_INTERVAL_MS;
}

/** The reset mail, in the app's own voice (해요체), with nothing about the diary in it. */
export function resetMailMessage(loginId: string, link: string): { subject: string; text: string; html: string } {
  const lines = [
    `PrivateDiary 아이디 ${loginId}의 로그인 비밀번호를 바꾸려면 아래 링크를 눌러 주세요.`,
    "",
    link,
    "",
    "직접 요청하지 않았다면 이 메일은 지워도 돼요. 비밀번호는 그대로예요.",
    "일기 암호는 이 링크로 바뀌지 않아요.",
  ];
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return {
    subject: "PrivateDiary 로그인 비밀번호 재설정",
    text: lines.join("\n"),
    html: [
      `<p>PrivateDiary 아이디 <b>${escape(loginId)}</b>의 로그인 비밀번호를 바꾸려면 아래 링크를 눌러 주세요.</p>`,
      `<p><a href="${escape(link)}">로그인 비밀번호 바꾸기</a></p>`,
      "<p>직접 요청하지 않았다면 이 메일은 지워도 돼요. 비밀번호는 그대로예요.<br>일기 암호는 이 링크로 바뀌지 않아요.</p>",
    ].join("\n"),
  };
}
