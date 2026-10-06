/**
 * The page's side of the Android app's native bridge
 * (android/.../NativeBridge.kt; wire format in BridgeProtocol.kt).
 *
 * Only exists in the Android build (IS_ANDROID_APP) AND only when the app
 * has injected `window.PrivateDiaryNative` — which it does solely for its
 * own origin, in the top frame. On the website every function here is a
 * no-op that reports "not available".
 *
 * No secret crosses it: the diary passphrase, the seed and the keys stay in
 * this page. The app only answers yes/no questions (did the biometric
 * check pass?) and carries out actions the person started.
 */
import { IS_ANDROID_APP } from "@/lib/platform";

interface NativeChannel {
  postMessage(message: string): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

declare global {
  interface Window {
    PrivateDiaryNative?: NativeChannel;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Error codes from the app: "cancelled", "lockout", "invalidated", "unavailable", "timeout", "failed", … */
export class NativeError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`native: ${code}`);
    this.name = "NativeError";
    this.code = code;
  }
}

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

let listening = false;
let nextId = 1;
const pending = new Map<number, Pending>();
const eventListeners = new Map<string, Set<(data: Record<string, unknown>) => void>>();

function channel(): NativeChannel | null {
  if (!IS_ANDROID_APP || typeof window === "undefined") return null;
  return window.PrivateDiaryNative ?? null;
}

export function isNativeApp(): boolean {
  return channel() !== null;
}

function onMessage(event: { data: unknown }) {
  const { data } = event;
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
  if (!entry) return;
  pending.delete(message.id);
  if (entry.timer) clearTimeout(entry.timer);
  if (message.ok === true) {
    entry.resolve((message.result ?? {}) as Record<string, unknown>);
  } else {
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
}

async function send(
  method: string,
  params: Record<string, unknown>,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: CallOptions
): Promise<Record<string, unknown>> {
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
            reject(new NativeError("timeout"));
          }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ch.postMessage(JSON.stringify({ id, method, params }));
  });
}

export async function callNative<T extends Record<string, unknown> = Record<string, unknown>>(
  method: string,
  params: Record<string, unknown> = {},
  options: CallOptions = {}
): Promise<T> {
  return (await send(method, params, options)) as T;
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
  /** versionName (android/version.properties). */
  version: string;
  /** Build number; every tester build gets a higher one. */
  versionCode: number;
  /** Short commit hash the build came from. */
  commit: string;
  capabilities: { googleSignIn: boolean };
  /** Soft warnings about the phone (android/.../DeviceSignals.kt). */
  signals: string[];
  keyboardOpen: boolean;
  /** Fully local mode: the app is refusing every network request (lib/native/app.ts setNetworkBlocked). */
  networkBlocked?: boolean;
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
  eventListeners.clear();
  helloPromise = null;
}
