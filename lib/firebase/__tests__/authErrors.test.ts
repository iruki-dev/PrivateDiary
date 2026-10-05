import { describe, expect, it } from "vitest";
import {
  isUserCancelledPopup,
  passwordResetErrorMessage,
  signInErrorMessage,
  signUpErrorMessage,
} from "../authErrors";

const err = (code: string) => Object.assign(new Error(code), { code });

describe("auth error messages", () => {
  it("separates the two causes the old signup copy lumped together", () => {
    expect(signUpErrorMessage(err("auth/email-already-in-use"))).toContain("이미 가입된");
    expect(signUpErrorMessage(err("auth/weak-password"))).toContain("6자");
  });

  it("does not reveal whether an email exists on sign-in", () => {
    expect(signInErrorMessage(err("auth/user-not-found"))).toBe(
      signInErrorMessage(err("auth/wrong-password"))
    );
  });

  it("tells network and rate-limit failures apart from bad credentials", () => {
    expect(signInErrorMessage(err("auth/network-request-failed"))).toContain("네트워크");
    expect(signInErrorMessage(err("auth/too-many-requests"))).toContain("잠시 후");
    expect(passwordResetErrorMessage(err("auth/invalid-email"))).toContain("형식");
  });

  it("falls back for unknown errors", () => {
    expect(signInErrorMessage(new Error("boom"))).toContain("로그인에 실패했습니다");
    expect(signUpErrorMessage("nope")).toContain("계정을 만들지 못했습니다");
  });

  it("recognises a popup the user closed", () => {
    expect(isUserCancelledPopup(err("auth/popup-closed-by-user"))).toBe(true);
    expect(isUserCancelledPopup(err("auth/popup-blocked"))).toBe(false);
  });
});
