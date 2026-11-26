/**
 * Answers no sooner than a fixed time after the request started, so how
 * long a public endpoint took doesn't tell the caller which path it took.
 *
 * Used by requestLoginPasswordReset: an id that doesn't exist answers at
 * once, while one with a reset email goes through several server reads and
 * writes. Without a floor that difference shows whether an id has a reset
 * email registered. The floor sits well above the slow path's usual time;
 * a request slower than the floor answers when it is done, which only
 * happens on the path that did the work anyway.
 */
export const RESET_REQUEST_FLOOR_MS = 2500;

export async function withResponseFloor<T>(
  floorMs: number,
  work: () => Promise<T>,
  clock: { now: () => number; sleep: (ms: number) => Promise<void> } = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
): Promise<T> {
  const started = clock.now();
  try {
    return await work();
  } finally {
    const remaining = started + floorMs - clock.now();
    if (remaining > 0) await clock.sleep(remaining);
  }
}
