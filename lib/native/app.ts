/**
 * Typed wrappers over the Android app's bridge methods (lib/native/bridge.ts).
 * Each one is only meaningful inside the app; callers check isNativeApp()
 * (or a capability from nativeHello()) first.
 */
import { callNative, callNativeForSecret } from "./bridge";

export type DeviceUnlockAvailability = "ready" | "no-hardware" | "none-enrolled" | "no-device-lock" | "unavailable";

export interface DeviceUnlockStatus {
  availability: DeviceUnlockAvailability;
  enrolled: boolean;
  /** Where the wrapping key lives: a separate security chip, or the main chip's secure area. */
  hardware: "strongbox" | "tee" | null;
}

export function deviceUnlockStatus(uid: string): Promise<DeviceUnlockStatus> {
  return callNative("vault.status", { uid }) as Promise<unknown> as Promise<DeviceUnlockStatus>;
}

/** Shows the biometric prompt and stores `seed` wrapped by a hardware key. The caller still wipes `seed`. */
export async function enrollDeviceUnlock(uid: string, seed: Uint8Array): Promise<void> {
  await callNative("vault.enroll", { uid }, { secret: seed, timeoutMs: null });
}

/** Shows the biometric prompt and returns the seed. The caller must wipe it. */
export function unwrapSeedWithDevice(uid: string): Promise<Uint8Array> {
  return callNativeForSecret("vault.unlock", { uid }, { timeoutMs: null });
}

/** With no uid: every account's key on this phone (sign-out). */
export async function forgetDeviceUnlock(uid?: string): Promise<void> {
  await callNative("vault.forget", uid ? { uid } : {});
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

export function reportRoute(path: string): void {
  void callNative("app.route", { path }).catch(() => {});
}

export function reportReady(): void {
  void callNative("app.ready").catch(() => {});
}
