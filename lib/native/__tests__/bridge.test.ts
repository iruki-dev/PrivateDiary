import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/native/bridge.ts against a stand-in for the Android app's injected
 * `PrivateDiaryNative` object, speaking the same wire format as
 * android/.../BridgeProtocol.kt.
 */

type Listener = (event: { data: unknown }) => void;

function installFakeApp(handle: (request: { id: number; method: string; params: Record<string, unknown> }, secret: Uint8Array | null, reply: (data: unknown) => void) => void) {
  const listeners: Listener[] = [];
  let pendingSecret: { id: number; bytes: Uint8Array } | null = null;
  const sentSecrets: Uint8Array[] = [];
  const reply = (data: unknown) => queueMicrotask(() => listeners.forEach((l) => l({ data })));
  (globalThis as unknown as { window: unknown }).window = {
    PrivateDiaryNative: {
      addEventListener: (_: string, l: Listener) => listeners.push(l),
      postMessage: (message: string | ArrayBuffer) => {
        if (message instanceof ArrayBuffer) {
          const bytes = new Uint8Array(message);
          pendingSecret = { id: new DataView(message).getInt32(1), bytes: bytes.slice(5) };
          sentSecrets.push(bytes);
          return;
        }
        const request = JSON.parse(message);
        const pending = pendingSecret as { id: number; bytes: Uint8Array } | null;
        const secret = pending && pending.id === request.id ? pending.bytes : null;
        pendingSecret = null;
        handle(request, secret, reply);
      },
    },
  };
  return { reply, sentSecrets };
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
    installFakeApp(({ id, method }, _secret, reply) =>
      reply(JSON.stringify({ id, ok: true, result: { echo: method } }))
    );
    const bridge = await loadBridge();
    const [a, b] = await Promise.all([bridge.callNative("app.hello"), bridge.callNative("vault.status")]);
    expect(a).toEqual({ echo: "app.hello" });
    expect(b).toEqual({ echo: "vault.status" });
  });

  it("turns app errors into NativeError codes", async () => {
    installFakeApp(({ id }, _s, reply) => reply(JSON.stringify({ id, ok: false, error: "cancelled" })));
    const bridge = await loadBridge();
    await expect(bridge.callNative("vault.unlock")).rejects.toMatchObject({ name: "NativeError", code: "cancelled" });
  });

  it("sends a secret as a binary frame and wipes the frame it built", async () => {
    let received: number[] | null = null;
    const { sentSecrets } = installFakeApp(({ id }, secret, reply) => {
      received = secret ? Array.from(secret) : null;
      reply(JSON.stringify({ id, ok: true, result: {} }));
    });
    const bridge = await loadBridge();
    const seed = new Uint8Array(32).fill(7);
    await bridge.callNative("vault.enroll", { uid: "u" }, { secret: seed });
    expect(received).toEqual(Array(32).fill(7));
    // The page's own copy of the outgoing frame is zeroed after posting.
    expect(Array.from(sentSecrets[0])).toEqual(Array(37).fill(0));
  });

  it("returns a secret that arrived as a binary frame, never as JSON", async () => {
    installFakeApp(({ id }, _s, reply) => {
      const frame = new Uint8Array(5 + 32);
      frame[0] = 2;
      new DataView(frame.buffer).setInt32(1, id);
      frame.fill(9, 5);
      reply(frame.buffer);
      reply(JSON.stringify({ id, ok: true, result: { binary: true } }));
    });
    const bridge = await loadBridge();
    const seed = await bridge.callNativeForSecret("vault.unlock", { uid: "u" });
    expect(Array.from(seed)).toEqual(Array(32).fill(9));
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
