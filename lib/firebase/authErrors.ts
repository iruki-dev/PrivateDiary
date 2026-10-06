/**
 * Firebase Auth error codes → what a person should do next, in Korean.
 * Kept free of Firebase imports so it is unit-testable; the code is read
 * structurally off whatever was thrown.
 */

export function authErrorCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return "";
}

/** True when the person closed the Google popup themselves — not an error worth showing. */
export function isUserCancelledPopup(err: unknown): boolean {
  const code = authErrorCode(err);
  return (
    code === "auth/popup-closed-by-user" ||
    code === "auth/cancelled-popup-request" ||
    // Android app: the person dismissed the system Google account sheet.
    code === "cancelled"
  );
}

const SHARED: Record<string, string> = {
  "auth/network-request-failed": "네트워크에 연결할 수 없습니다. 연결을 확인한 뒤 다시 시도해주세요.",
  "auth/too-many-requests": "시도 횟수가 너무 많습니다. 잠시 후 다시 시도해주세요.",
  "auth/invalid-email": "이메일 주소 형식이 올바르지 않습니다.",
  "auth/user-disabled": "사용이 중지된 계정입니다.",
  "auth/popup-blocked": "브라우저가 Google 로그인 창을 차단했습니다. 팝업을 허용한 뒤 다시 시도해주세요.",
  // Android app (lib/native/app.ts googleIdToken)
  "no-account": "이 휴대폰에 Google 계정이 없습니다. 휴대폰 설정에서 계정을 추가한 뒤 다시 시도해주세요.",
  "not-configured": "이 앱에서는 Google 로그인을 쓸 수 없습니다. 이메일로 로그인해주세요.",
};

export function signInErrorMessage(err: unknown): string {
  const code = authErrorCode(err);
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "이메일 또는 비밀번호가 올바르지 않습니다.";
    default:
      return SHARED[code] ?? "로그인에 실패했습니다. 다시 시도해주세요.";
  }
}

export function signUpErrorMessage(err: unknown): string {
  const code = authErrorCode(err);
  switch (code) {
    case "auth/email-already-in-use":
      return "이미 가입된 이메일입니다. 로그인하거나 다른 이메일을 사용해주세요.";
    case "auth/weak-password":
      return "로그인 비밀번호는 6자 이상이어야 합니다.";
    case "auth/account-exists-with-different-credential":
      return "같은 이메일로 다른 방식(이메일 또는 Google)으로 가입된 계정이 있습니다.";
    default:
      return SHARED[code] ?? "계정을 만들지 못했습니다. 다시 시도해주세요.";
  }
}

export function passwordResetErrorMessage(err: unknown): string {
  return SHARED[authErrorCode(err)] ?? "메일을 보내지 못했습니다. 다시 시도해주세요.";
}
