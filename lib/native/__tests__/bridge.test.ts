import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/native/bridge.ts against a stand-in for the Android app's injected
 * `PrivateDiaryNative` object, speaking the same wire format as
 * android/.../BridgeProtocol.kt.
 */

type Listener = (event: { data: unknown }) => void;

function installFakeApp(handle: (request: { id: number; method: string; params: Record<string, unknown> }, reply: (data: unknown) => void) => void) {
  const listeners: Listener[] = [];
  const sent: unknown[] = [];
  const reply = (data: unknown) => queueMicrotask(() => listeners.forEach((l) => l({ data })));
  (globalThis as unknown as { window: unknown }).window = {
    PrivateDiaryNative: {
      addEventListener: (_: string, l: Listener) => listeners.push(l),
      postMessage: (message: unknown) => {
        sent.push(message);
        handle(JSON.parse(message as string), reply);
      },
    },
  };
  return { reply, sent };
}

async function loadBridge() {
  vi.stubEnv("NEXT_PUBLIC_PLATFORM", "android");
  vi.resetModules();
  return import("../bridge");
}

describe("native bridge", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as { window?: unknown }).window;
  });

  it("is absent on the website build", async () => {
    vi.stubEnv("NEXT_PUBLIC_PLATFORM", "");
    vi.resetModules();
    installFakeApp(() => {});
    const bridge = await import("../bridge");
    expect(bridge.isNativeApp()).toBe(false);
    await expect(bridge.callNative("haptic")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("matches responses to requests by id", async () => {
    installFakeApp(({ id, method }, reply) =>
      reply(JSON.stringify({ id, ok: true, result: { echo: method } }))
    );
    const bridge = await loadBridge();
    const [a, b] = await Promise.all([bridge.callNative("app.hello"), bridge.callNative("gate.status")]);
    expect(a).toEqual({ echo: "app.hello" });
    expect(b).toEqual({ echo: "gate.status" });
  });

  it("turns app errors into NativeError codes", async () => {
    installFakeApp(({ id }, reply) => reply(JSON.stringify({ id, ok: false, error: "cancelled" })));
    const bridge = await loadBridge();
    await expect(bridge.callNative("gate.verify")).rejects.toMatchObject({ name: "NativeError", code: "cancelled" });
  });

  it("only ever sends JSON text, and ignores binary replies", async () => {
    const { sent } = installFakeApp(({ id }, reply) => {
      reply(new Uint8Array([2, 0, 0, 0, id, 9, 9]).buffer);
      reply(JSON.stringify({ id, ok: true, result: { done: true } }));
    });
    const bridge = await loadBridge();
    await expect(bridge.callNative("gate.verify", { uid: "u" })).resolves.toEqual({ done: true });
    expect(sent.every((m) => typeof m === "string")).toBe(true);
  });

  it("delivers app events to subscribers", async () => {
    const { reply } = installFakeApp(() => {});
    const bridge = await loadBridge();
    const seen: unknown[] = [];
    const off = bridge.onNativeEvent("lifecycle", (data) => seen.push(data.state));
    reply(JSON.stringify({ event: "lifecycle", data: { state: "background" } }));
    await new Promise((r) => setTimeout(r, 0));
    off();
    reply(JSON.stringify({ event: "lifecycle", data: { state: "foreground" } }));
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(["background"]);
  });

  it("times out calls the app never answers", async () => {
    installFakeApp(() => {});
    const bridge = await loadBridge();
    await expect(bridge.callNative("haptic", {}, { timeoutMs: 10 })).rejects.toMatchObject({ code: "timeout" });
  });
});
