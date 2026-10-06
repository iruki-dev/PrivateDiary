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
  "auth/network-request-failed": "인터넷에 연결되어 있지 않아요. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
  "auth/too-many-requests": "여러 번 시도해서 잠시 막아 두었어요. 잠시 후 다시 시도해 주세요.",
  "auth/invalid-email": "아이디나 이메일 형식을 확인해 주세요.",
  "auth/user-disabled": "쓸 수 없게 막힌 계정이에요.",
  "auth/popup-blocked": "브라우저가 Google 로그인 창을 막았어요. 팝업을 허용한 뒤 다시 시도해 주세요.",
  // Android app (lib/native/app.ts googleIdToken)
  "no-account": "이 휴대폰에 Google 계정이 없어요. 휴대폰 설정에서 계정을 추가한 뒤 다시 시도해 주세요.",
  "not-configured": "이 앱에서는 Google 로그인을 쓸 수 없어요. 아이디로 로그인해 주세요.",
};

export function signInErrorMessage(err: unknown): string {
  const code = authErrorCode(err);
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "아이디나 로그인 비밀번호를 다시 확인해 주세요.";
    default:
      return SHARED[code] ?? "로그인하지 못했어요. 다시 시도해 주세요.";
  }
}

export function signUpErrorMessage(err: unknown): string {
  const code = authErrorCode(err);
  switch (code) {
    case "auth/email-already-in-use":
      return "이미 쓰고 있는 아이디예요. 다른 아이디를 정해 주세요.";
    case "auth/weak-password":
      return "로그인 비밀번호는 6자 이상으로 정해 주세요.";
    case "auth/account-exists-with-different-credential":
      return "같은 이메일로 다른 방법(아이디 또는 Google)으로 가입한 계정이 있어요.";
    default:
      return SHARED[code] ?? "계정을 만들지 못했어요. 다시 시도해 주세요.";
  }
}

export function passwordResetErrorMessage(err: unknown): string {
  const code = authErrorCode(err);
  if (code === "functions/invalid-argument") return "아이디를 다시 확인해 주세요.";
  return SHARED[code] ?? "메일을 보내지 못했어요. 다시 시도해 주세요.";
}
