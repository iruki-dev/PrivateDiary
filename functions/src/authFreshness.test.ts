import { describe, expect, it } from "vitest";
import { isAuthTimeFresh } from "./authFreshness";

/**
 * security-patch-v2 / C2: startOtpSetup's first-enroll branch used to
 * accept any signed-in session, letting a session-only attacker (stolen ID
 * token, no passphrase, no Shamir shares) enable OTP with a secret only
 * they know and permanently lock the real owner out of every entry. The
 * fix requires the caller's ID token to have been minted from an actual
 * sign-in within REAUTH_MAX_AGE_MS — this is the pure freshness check
 * behind that gate.
 */
describe("isAuthTimeFresh", () => {
  const MAX_AGE_MS = 5 * 60 * 1000;

  it("accepts an auth_time from right now", () => {
    const now = 1_700_000_000_000;
    expect(isAuthTimeFresh(now / 1000, now, MAX_AGE_MS)).toBe(true);
  });

  it("accepts an auth_time exactly at the boundary of the allowed age", () => {
    const now = 1_700_000_000_000;
    const authTimeSeconds = (now - MAX_AGE_MS) / 1000;
    expect(isAuthTimeFresh(authTimeSeconds, now, MAX_AGE_MS)).toBe(true);
  });

  it("rejects an auth_time one second past the allowed age — a long-lived, silently-refreshed session token", () => {
    const now = 1_700_000_000_000;
    const authTimeSeconds = (now - MAX_AGE_MS - 1000) / 1000;
    expect(isAuthTimeFresh(authTimeSeconds, now, MAX_AGE_MS)).toBe(false);
  });

  it("rejects an auth_time from hours ago — the actual attack this closes: a stolen/long-lived session with no recent real sign-in", () => {
    const now = 1_700_000_000_000;
    const hoursAgoSeconds = (now - 6 * 60 * 60 * 1000) / 1000;
    expect(isAuthTimeFresh(hoursAgoSeconds, now, MAX_AGE_MS)).toBe(false);
  });

  it("rejects an auth_time in the future (clock skew or a forged claim) rather than treating it as fresh", () => {
    const now = 1_700_000_000_000;
    const futureSeconds = (now + 60_000) / 1000;
    expect(isAuthTimeFresh(futureSeconds, now, MAX_AGE_MS)).toBe(false);
  });

  it("rejects non-finite input defensively (a malformed or missing claim must never read as fresh)", () => {
    expect(isAuthTimeFresh(NaN, Date.now(), MAX_AGE_MS)).toBe(false);
    expect(isAuthTimeFresh(Infinity, Date.now(), MAX_AGE_MS)).toBe(false);
  });
});
