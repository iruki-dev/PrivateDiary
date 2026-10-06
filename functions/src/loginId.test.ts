import { describe, expect, it } from "vitest";
import {
  loginIdFromEmail,
  loginIdToEmail,
  mayResendResetMail,
  parseLoginId,
  parseRecoveryEmail,
  resetMailMessage,
  RESET_MAIL_INTERVAL_MS,
} from "./loginId";
import { missingCredentialProof } from "./authFreshness";

describe("login ids", () => {
  it("normalizes and validates the id", () => {
    expect(parseLoginId({ loginId: "  Diary_Kim " })).toBe("diary_kim");
    expect(parseLoginId({ loginId: "abc" })).toBeNull();
    expect(parseLoginId({ loginId: "a".repeat(21) })).toBeNull();
    expect(parseLoginId({ loginId: "has space" })).toBeNull();
    expect(parseLoginId({ loginId: "kim@example.com" })).toBeNull();
    expect(parseLoginId({})).toBeNull();
    expect(parseLoginId(null)).toBeNull();
  });

  it("round-trips through the reserved email domain", () => {
    expect(loginIdToEmail("diary_kim")).toBe("diary_kim@id.privatediary.invalid");
    expect(loginIdFromEmail("diary_kim@id.privatediary.invalid")).toBe("diary_kim");
    expect(loginIdFromEmail("kim@example.com")).toBeNull();
    expect(loginIdFromEmail(undefined)).toBeNull();
  });
});

describe("parseRecoveryEmail", () => {
  it("accepts a plausible address and null", () => {
    expect(parseRecoveryEmail({ email: " kim@example.com " })).toEqual({ kind: "set", email: "kim@example.com" });
    expect(parseRecoveryEmail({ email: null })).toEqual({ kind: "clear" });
  });

  it("refuses everything else, including the reserved id domain", () => {
    expect(parseRecoveryEmail({ email: "not an email" })).toEqual({ kind: "invalid" });
    expect(parseRecoveryEmail({ email: 3 })).toEqual({ kind: "invalid" });
    expect(parseRecoveryEmail({})).toEqual({ kind: "invalid" });
    expect(parseRecoveryEmail({ email: "x@id.privatediary.invalid" })).toEqual({ kind: "invalid" });
    expect(parseRecoveryEmail({ email: `${"a".repeat(250)}@b.co` })).toEqual({ kind: "invalid" });
  });
});

describe("reset mail", () => {
  it("is throttled per account", () => {
    expect(mayResendResetMail(null, 1_000)).toBe(true);
    expect(mayResendResetMail(1_000, 1_000 + RESET_MAIL_INTERVAL_MS - 1)).toBe(false);
    expect(mayResendResetMail(1_000, 1_000 + RESET_MAIL_INTERVAL_MS)).toBe(true);
  });

  it("escapes what it puts into HTML", () => {
    const message = resetMailMessage("diary_kim", 'https://x.example/?a=1&b="2"');
    expect(message.html).toContain("&amp;b=&quot;2&quot;");
    expect(message.text).toContain("일기 암호는 이 링크로 바뀌지 않아요.");
  });
});

describe("missingCredentialProof", () => {
  const now = 10_000_000_000;
  it("asks a non-OTP account for a recent sign-in", () => {
    expect(missingCredentialProof({ auth_time: now / 1000 - 60 }, now, 5 * 60_000)).toBeNull();
    expect(missingCredentialProof({ auth_time: now / 1000 - 600 }, now, 5 * 60_000)).toBe("reauth");
    expect(missingCredentialProof({}, now, 5 * 60_000)).toBe("reauth");
  });

  it("asks an OTP account for a verified code from the last 12 hours", () => {
    expect(
      missingCredentialProof({ otpEnabled: true, otpVerified: true, otpVerifiedAt: now - 60_000 }, now, 5 * 60_000)
    ).toBeNull();
    expect(
      missingCredentialProof({ otpEnabled: true, otpVerified: true, otpVerifiedAt: now - 13 * 3600_000 }, now, 5 * 60_000)
    ).toBe("otp");
    // A fresh sign-in alone doesn't stand in for the code.
    expect(missingCredentialProof({ otpEnabled: true, auth_time: now / 1000 }, now, 5 * 60_000)).toBe("otp");
  });
});
