import { describe, expect, it } from "vitest";
import { withResponseFloor } from "./responseFloor";

function fakeClock() {
  let t = 1_000;
  const slept: number[] = [];
  return {
    slept,
    advance: (ms: number) => {
      t += ms;
    },
    clock: {
      now: () => t,
      sleep: async (ms: number) => {
        slept.push(ms);
        t += ms;
      },
    },
  };
}

describe("withResponseFloor", () => {
  it("makes a fast answer wait until the floor", async () => {
    const c = fakeClock();
    const result = await withResponseFloor(2500, async () => {
      c.advance(10);
      return "fast";
    }, c.clock);
    expect(result).toBe("fast");
    expect(c.slept).toEqual([2490]);
  });

  it("doesn't add time to an answer already past the floor", async () => {
    const c = fakeClock();
    await withResponseFloor(2500, async () => c.advance(3000), c.clock);
    expect(c.slept).toEqual([]);
  });

  it("holds a failure to the floor too", async () => {
    const c = fakeClock();
    await expect(
      withResponseFloor(2500, async () => {
        c.advance(5);
        throw new Error("boom");
      }, c.clock)
    ).rejects.toThrow("boom");
    expect(c.slept).toEqual([2495]);
  });
});
