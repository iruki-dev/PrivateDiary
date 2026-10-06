import { describe, expect, it } from "vitest";
import {
  isEmailLike,
  isPlausibleEmail,
  loginIdFromEmail,
  loginIdProblem,
  loginIdToEmail,
  nicknameProblem,
  normalizeLoginId,
  normalizeNickname,
  signInEmailFor,
} from "../loginId";

describe("login ids", () => {
  it("normalizes case and surrounding spaces", () => {
    expect(normalizeLoginId("  Diary_Kim ")).toBe("diary_kim");
  });

  it("explains what's wrong with an id", () => {
    expect(loginIdProblem("abc")).toContain("4–20자");
    expect(loginIdProblem("a".repeat(21))).toContain("4–20자");
    expect(loginIdProblem("kim.diary")).toContain("영문 소문자");
    expect(loginIdProblem("김일기장")).toContain("영문 소문자");
    expect(loginIdProblem("diary_kim1")).toBeNull();
  });

  it("maps an id to its reserved-domain email and back", () => {
    const email = loginIdToEmail("Diary_Kim");
    expect(email).toBe("diary_kim@id.privatediary.invalid");
    expect(loginIdFromEmail(email)).toBe("diary_kim");
    expect(loginIdFromEmail("kim@example.com")).toBeNull();
    expect(loginIdFromEmail(null)).toBeNull();
  });

  it("lets accounts made with an email keep signing in with it", () => {
    expect(isEmailLike("kim@example.com")).toBe(true);
    expect(signInEmailFor(" kim@example.com ")).toBe("kim@example.com");
    expect(signInEmailFor("Diary_Kim")).toBe("diary_kim@id.privatediary.invalid");
  });
});

describe("nicknames", () => {
  it("collapses spaces and checks length in characters, not bytes", () => {
    expect(normalizeNickname("  하루   기록  ")).toBe("하루 기록");
    expect(nicknameProblem("")).not.toBeNull();
    expect(nicknameProblem("가".repeat(20))).toBeNull();
    expect(nicknameProblem("가".repeat(21))).not.toBeNull();
    expect(nicknameProblem("a\u0007b")).not.toBeNull();
  });
});

describe("reset email", () => {
  it("takes a plausible address and refuses the id domain", () => {
    expect(isPlausibleEmail("kim@example.com")).toBe(true);
    expect(isPlausibleEmail("kim@example")).toBe(false);
    expect(isPlausibleEmail("kim example@x.com")).toBe(false);
    expect(isPlausibleEmail("x@id.privatediary.invalid")).toBe(false);
  });
});
