import { describe, expect, it } from "vitest";
import {
  DEFAULT_DAILY_ENTRY_LIMIT,
  RATE_LIMIT_WINDOW_MS,
  decideRateLimit,
  resolveDailyEntryLimit,
  type RateLimitCounterState,
} from "./entryRateLimit";

/**
 * PENTEST FINDING F-2: bounds how many undeletable `entries` a
 * session-only attacker (or, harmlessly, a very enthusiastic real user)
 * can accumulate per rolling 24h window. Pure unit tests for the
 * counting/threshold decision — the Firestore trigger wiring
 * (index.ts's enforceEntryRateLimit) is exercised separately via the
 * emulator.
 */
describe("decideRateLimit", () => {
  const NOW = 1_700_000_000_000;

  it("starts a fresh window at count 1 when there is no previous state", () => {
    const { next, overLimit } = decideRateLimit(null, NOW, 100);
    expect(next).toEqual({ windowStartMs: NOW, count: 1 });
    expect(overLimit).toBe(false);
  });

  it("increments the count within the same window", () => {
    const previous: RateLimitCounterState = { windowStartMs: NOW - 1000, count: 5 };
    const { next } = decideRateLimit(previous, NOW, 100);
    expect(next).toEqual({ windowStartMs: NOW - 1000, count: 6 });
  });

  it("resets to a fresh window once RATE_LIMIT_WINDOW_MS has fully elapsed", () => {
    const previous: RateLimitCounterState = { windowStartMs: NOW - RATE_LIMIT_WINDOW_MS, count: 99 };
    const { next } = decideRateLimit(previous, NOW, 100);
    expect(next).toEqual({ windowStartMs: NOW, count: 1 });
  });

  it("does NOT reset one millisecond before the window elapses", () => {
    const previous: RateLimitCounterState = {
      windowStartMs: NOW - RATE_LIMIT_WINDOW_MS + 1,
      count: 99,
    };
    const { next } = decideRateLimit(previous, NOW, 100);
    expect(next).toEqual({ windowStartMs: NOW - RATE_LIMIT_WINDOW_MS + 1, count: 100 });
  });

  it("flags overLimit exactly when the new count exceeds the effective limit, not merely equals it", () => {
    const previous: RateLimitCounterState = { windowStartMs: NOW - 1000, count: 99 };
    expect(decideRateLimit(previous, NOW, 100).overLimit).toBe(false); // count becomes 100 == limit
    const atLimit: RateLimitCounterState = { windowStartMs: NOW - 1000, count: 100 };
    expect(decideRateLimit(atLimit, NOW, 100).overLimit).toBe(true); // count becomes 101 > limit
  });

  it("treats a limit of 0 (or negative) as unlimited — never flags overLimit — while still tracking the count", () => {
    const previous: RateLimitCounterState = { windowStartMs: NOW - 1000, count: 1_000_000 };
    const { next, overLimit } = decideRateLimit(previous, NOW, 0);
    expect(overLimit).toBe(false);
    expect(next.count).toBe(1_000_001);
  });

  it("this exact decision is what turns the PENTEST F-2 mass-injection attack from unlimited into self-closing", () => {
    // Simulate an attacker hammering entries/create with a low configured
    // limit: the Nth call (N = limit + 1) must be the first one flagged.
    const limit = 10;
    let state: RateLimitCounterState | null = null;
    let firstOverLimitAt = -1;
    for (let i = 1; i <= limit + 5; i += 1) {
      const decision = decideRateLimit(state, NOW + i, limit);
      state = decision.next;
      if (decision.overLimit && firstOverLimitAt === -1) firstOverLimitAt = i;
    }
    expect(firstOverLimitAt).toBe(limit + 1);
  });
});

describe("resolveDailyEntryLimit", () => {
  it("passes through a valid stored limit", () => {
    expect(resolveDailyEntryLimit(25)).toBe(25);
  });

  it("passes through 0 (the explicit unlimited choice) rather than treating it as missing", () => {
    expect(resolveDailyEntryLimit(0)).toBe(0);
  });

  it("falls back to the default for a missing/undefined value (account predates the field)", () => {
    expect(resolveDailyEntryLimit(undefined)).toBe(DEFAULT_DAILY_ENTRY_LIMIT);
  });

  it("falls back to the default for junk values a rules regression or tampering could otherwise let through", () => {
    for (const bad of [-1, NaN, Infinity, "100", null, {}, []]) {
      expect(resolveDailyEntryLimit(bad)).toBe(DEFAULT_DAILY_ENTRY_LIMIT);
    }
  });
});
