/**
 * The page's side of the Android app's native bridge
 * (android/.../NativeBridge.kt; wire format in BridgeProtocol.kt).
 *
 * Only exists in the Android build (IS_ANDROID_APP) AND only when the app
 * has injected `window.PrivateDiaryNative` — which it does solely for its
 * own origin, in the top frame. On the website every function here is a
 * no-op that reports "not available".
 *
 * Secrets (the diary's master seed) cross as binary frames, never as JSON
 * text: a Uint8Array can be zeroed after use, a JS string can't. Both
 * sides wipe their copy as soon as it has been used.
 */
import { IS_ANDROID_APP } from "@/lib/platform";

interface NativeChannel {
  postMessage(message: string | ArrayBuffer): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

declare global {
  interface Window {
    PrivateDiaryNative?: NativeChannel;
  }
}

const FRAME_SECRET_TO_APP = 1;
const FRAME_SECRET_TO_PAGE = 2;
const DEFAULT_TIMEOUT_MS = 15_000;

/** Error codes from the app: "cancelled", "use-passphrase", "lockout", "invalidated", "not-enrolled", "unavailable", "failed", … */
export class NativeError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`native: ${code}`);
    this.name = "NativeError";
    this.code = code;
  }
}

interface Pending {
  resolve: (value: { result: Record<string, unknown>; secret: Uint8Array | null }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

let listening = false;
let nextId = 1;
const pending = new Map<number, Pending>();
const secrets = new Map<number, Uint8Array>();
const eventListeners = new Map<string, Set<(data: Record<string, unknown>) => void>>();

function channel(): NativeChannel | null {
  if (!IS_ANDROID_APP || typeof window === "undefined") return null;
  return window.PrivateDiaryNative ?? null;
}

export function isNativeApp(): boolean {
  return channel() !== null;
}

function wipeSecrets() {
  for (const secret of secrets.values()) secret.fill(0);
  secrets.clear();
}

function onMessage(event: { data: unknown }) {
  const { data } = event;
  if (data instanceof ArrayBuffer) {
    const bytes = new Uint8Array(data);
    if (bytes.length >= 5 && bytes[0] === FRAME_SECRET_TO_PAGE) {
      const id = new DataView(data).getInt32(1);
      secrets.get(id)?.fill(0);
      secrets.set(id, bytes.slice(5));
    }
    bytes.fill(0);
    return;
  }
  if (typeof data !== "string") return;
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(data);
  } catch {
    return;
  }
  if (typeof message.event === "string") {
    const payload = (message.data ?? {}) as Record<string, unknown>;
    eventListeners.get(message.event)?.forEach((listener) => listener(payload));
    return;
  }
  if (typeof message.id !== "number") return;
  const entry = pending.get(message.id);
  const secret = secrets.get(message.id) ?? null;
  secrets.delete(message.id);
  if (!entry) {
    secret?.fill(0);
    return;
  }
  pending.delete(message.id);
  if (entry.timer) clearTimeout(entry.timer);
  if (message.ok === true) {
    entry.resolve({ result: (message.result ?? {}) as Record<string, unknown>, secret });
  } else {
    secret?.fill(0);
    entry.reject(new NativeError(typeof message.error === "string" ? message.error : "failed"));
  }
}

function ensureListening(ch: NativeChannel) {
  if (listening) return;
  ch.addEventListener("message", onMessage);
  listening = true;
}

interface CallOptions {
  /** null: no timeout — for calls that wait on the person (biometric prompt, file picker). */
  timeoutMs?: number | null;
  /** Sent as a binary frame ahead of the request. The caller keeps ownership and should wipe it. */
  secret?: Uint8Array;
}

async function send(
  method: string,
  params: Record<string, unknown>,
  { timeoutMs = DEFAULT_TIMEOUT_MS, secret }: CallOptions
): Promise<{ result: Record<string, unknown>; secret: Uint8Array | null }> {
  const ch = channel();
  if (!ch) throw new NativeError("unavailable");
  ensureListening(ch);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer =
      timeoutMs === null
        ? null
        : setTimeout(() => {
            pending.delete(id);
            secrets.get(id)?.fill(0);
            secrets.delete(id);
            reject(new NativeError("timeout"));
          }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    if (secret) {
      const frame = new Uint8Array(5 + secret.length);
      frame[0] = FRAME_SECRET_TO_APP;
      new DataView(frame.buffer).setInt32(1, id);
      frame.set(secret, 5);
      ch.postMessage(frame.buffer);
      frame.fill(0);
    }
    ch.postMessage(JSON.stringify({ id, method, params }));
  });
}

/** A call whose result is plain JSON. Any secret the app sent alongside is wiped unread. */
export async function callNative<T extends Record<string, unknown> = Record<string, unknown>>(
  method: string,
  params: Record<string, unknown> = {},
  options: CallOptions = {}
): Promise<T> {
  const { result, secret } = await send(method, params, options);
  secret?.fill(0);
  return result as T;
}

/** A call that returns a secret as bytes. The caller must zero it after use. */
export async function callNativeForSecret(
  method: string,
  params: Record<string, unknown> = {},
  options: CallOptions = {}
): Promise<Uint8Array> {
  const { secret } = await send(method, params, options);
  if (!secret) throw new NativeError("failed");
  return secret;
}

export function onNativeEvent(name: string, listener: (data: Record<string, unknown>) => void): () => void {
  const ch = channel();
  if (!ch) return () => {};
  ensureListening(ch);
  let set = eventListeners.get(name);
  if (!set) {
    set = new Set();
    eventListeners.set(name, set);
  }
  set.add(listener);
  return () => set.delete(listener);
}

export interface NativeHello {
  version: string;
  capabilities: { binary: boolean; googleSignIn: boolean };
  /** Soft warnings about the phone (android/.../DeviceSignals.kt). */
  signals: string[];
  keyboardOpen: boolean;
}

let helloPromise: Promise<NativeHello | null> | null = null;

/** What the app supports, asked once per page load. Null on the website. */
export function nativeHello(): Promise<NativeHello | null> {
  if (!helloPromise) {
    helloPromise = isNativeApp()
      ? callNative<Record<string, unknown>>("app.hello").then((r) => r as unknown as NativeHello).catch(() => null)
      : Promise.resolve(null);
  }
  return helloPromise;
}

/** Test-only: forget all module state. */
export function resetNativeBridgeForTests() {
  listening = false;
  nextId = 1;
  for (const entry of pending.values()) if (entry.timer) clearTimeout(entry.timer);
  pending.clear();
  wipeSecrets();
  eventListeners.clear();
  helloPromise = null;
}
