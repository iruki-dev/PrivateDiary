/**
 * Sign-in with an id instead of an email address.
 *
 * Firebase Authentication's password sign-in is keyed by an email, so an
 * id is stored as an address under a reserved domain that can never
 * receive mail (`.invalid`, RFC 2606): "diary_kim" signs in as
 * "diary_kim@id.privatediary.invalid". Nobody types or sees that address;
 * Firebase still enforces that two accounts can't share it, which is what
 * makes ids unique.
 *
 * A real email is only ever kept for one purpose — where a login-password
 * reset link goes — and only if the owner adds it (lib/firebase/profile.ts).
 * Accounts made with an email before ids existed keep signing in with that
 * email: the sign-in field takes either, told apart by the "@".
 *
 * MUST match functions/src/loginId.ts (the two packages don't share
 * modules — same convention as REAUTH_REQUIRED_MESSAGE).
 *
 * Pure: no Firebase import, so it unit-tests directly.
 */

export const LOGIN_ID_EMAIL_DOMAIN = "id.privatediary.invalid";
export const LOGIN_ID_MIN_LENGTH = 4;
export const LOGIN_ID_MAX_LENGTH = 20;
const LOGIN_ID_PATTERN = /^[a-z0-9_]+$/;

export const NICKNAME_MAX_LENGTH = 20;

/** Ids are case-insensitive: typed in any case, stored lower-case. */
export function normalizeLoginId(input: string): string {
  return input.trim().toLowerCase();
}

/** Why `id` (already normalized) can't be used, in words; null when it can. */
export function loginIdProblem(id: string): string | null {
  if (id.length < LOGIN_ID_MIN_LENGTH || id.length > LOGIN_ID_MAX_LENGTH) {
    return `아이디는 ${LOGIN_ID_MIN_LENGTH}–${LOGIN_ID_MAX_LENGTH}자로 정해 주세요.`;
  }
  if (!LOGIN_ID_PATTERN.test(id)) {
    return "아이디에는 영문 소문자, 숫자, 밑줄(_)만 쓸 수 있어요.";
  }
  return null;
}

export function isValidLoginId(id: string): boolean {
  return loginIdProblem(id) === null;
}

export function loginIdToEmail(id: string): string {
  return `${normalizeLoginId(id)}@${LOGIN_ID_EMAIL_DOMAIN}`;
}

/** The id behind an account's Firebase email, or null for an email (or Google) account. */
export function loginIdFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const suffix = `@${LOGIN_ID_EMAIL_DOMAIN}`;
  if (!email.toLowerCase().endsWith(suffix)) return null;
  const id = email.slice(0, -suffix.length).toLowerCase();
  return isValidLoginId(id) ? id : null;
}

/** What the sign-in field holds: an id, or the email of an account made before ids. */
export function isEmailLike(input: string): boolean {
  return input.includes("@");
}

/** The Firebase email to sign in with for whatever was typed into the sign-in field. */
export function signInEmailFor(input: string): string {
  return isEmailLike(input) ? input.trim() : loginIdToEmail(input);
}

/** Spaces collapsed, ends trimmed. */
export function normalizeNickname(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function nicknameProblem(nickname: string): string | null {
  if (nickname.length === 0) return "닉네임을 정해 주세요.";
  if ([...nickname].length > NICKNAME_MAX_LENGTH) return `닉네임은 ${NICKNAME_MAX_LENGTH}자까지 쓸 수 있어요.`;
  if (/[\u0000-\u001f\u007f]/.test(nickname)) return "닉네임에 쓸 수 없는 글자가 있어요.";
  return null;
}

/** A deliberately loose check: something@something.tld, no spaces. The server checks the same. */
export function isPlausibleEmail(input: string): boolean {
  const email = input.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.toLowerCase().endsWith(`@${LOGIN_ID_EMAIL_DOMAIN}`);
}
