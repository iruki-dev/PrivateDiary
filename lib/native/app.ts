/**
 * Typed wrappers over the Android app's bridge methods (lib/native/bridge.ts).
 * Each one is only meaningful inside the app; callers check isNativeApp()
 * (or a capability from nativeHello()) first.
 */
import { callNative } from "./bridge";

export type BiometricAvailability = "ready" | "no-hardware" | "none-enrolled" | "no-device-lock" | "unavailable";

/**
 * The biometric check (android/.../BiometricGate.kt): an ADDITIONAL factor
 * on top of the diary passphrase, like OTP — never a replacement for it.
 */
export interface BiometricGateStatus {
  availability: BiometricAvailability;
  enabled: boolean;
  /** On, but a fingerprint or face was added since: the check can't pass until it's set up again. */
  invalidated: boolean;
  /** Where the check's key lives: a separate security chip, or the main chip's secure area. */
  hardware: "strongbox" | "tee" | null;
}

/** The biometric check didn't pass; `code` is the app's reason ("cancelled", "invalidated", "lockout", …). */
export class BiometricGateError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`biometric check: ${code}`);
    this.name = "BiometricGateError";
    this.code = code;
  }
}

export function biometricGateStatus(uid: string): Promise<BiometricGateStatus> {
  return callNative("gate.status", { uid }) as Promise<unknown> as Promise<BiometricGateStatus>;
}

/** Creates the check's key and passes one check with it. */
export async function enableBiometricGate(uid: string): Promise<void> {
  await callNative("gate.enable", { uid }, { timeoutMs: null });
}

/** Shows the biometric prompt; resolves only if the check passed (or the gate is off). */
export async function verifyBiometricGate(uid: string): Promise<void> {
  await callNative("gate.verify", { uid }, { timeoutMs: null });
}

/** Turning it off takes a passing check. */
export async function disableBiometricGate(uid: string): Promise<void> {
  await callNative("gate.disable", { uid }, { timeoutMs: null });
}

/** Only after the person re-proved the login (Firebase reauthentication). */
export async function resetBiometricGate(uid: string): Promise<void> {
  await callNative("gate.reset", { uid });
}

export async function copySensitive(text: string, clearAfterMs: number): Promise<void> {
  await callNative("clipboard.copySensitive", { text, clearAfterMs });
}

/** Opens Android's "save as" sheet. Resolves false if the person backed out. */
export async function saveFile(filename: string, mimeType: string, content: string): Promise<boolean> {
  const { saved } = await callNative<{ saved: boolean }>(
    "file.save",
    { filename, mimeType, content },
    { timeoutMs: null }
  );
  return saved;
}

export async function googleIdToken(): Promise<string> {
  const { idToken } = await callNative<{ idToken: string }>("google.idToken", {}, { timeoutMs: null });
  return idToken;
}

export function haptic(kind: "confirm" | "reject" | "tick"): void {
  void callNative("haptic", { kind }).catch(() => {});
}

/** Whether Android's autofill may serve the page right now (lib/native/autofill.ts). */
export function reportAutofillAllowed(allowed: boolean): void {
  void callNative("app.autofill", { allowed }).catch(() => {});
}

export function reportReady(): void {
  void callNative("app.ready").catch(() => {});
}

/**
 * Fully local mode (lib/deviceMode.ts): the app refuses every request that
 * would leave the phone — the page's own CSP aside, as a second wall in
 * the app itself — and keeps refusing across restarts until this is
 * called with false.
 */
export async function setNetworkBlocked(blocked: boolean): Promise<void> {
  await callNative("app.network", { blocked });
}

/**
 * Opens Android's document picker and returns the chosen file's text.
 * Rejects with NativeError("cancelled") if the person backed out, and
 * "too-large" for anything over the app's limit.
 */
export async function openTextFile(): Promise<{ name: string | null; content: string }> {
  return callNative<{ name: string | null; content: string }>("file.open", {}, { timeoutMs: null });
}
