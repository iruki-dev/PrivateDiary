/**
 * Which diary this device works with — a per-device choice, kept in the
 * app's own storage (the Android app's WebView sandbox):
 *
 *   - "cloud": an account on the server (the website is always this).
 *   - "local": the Android app's fully local diary (lib/store/local.ts).
 *     The app then also blocks every network request
 *     (MainActivity.setNetworkBlocked), so nothing about the diary — not
 *     even that it exists — reaches a server.
 *
 * The two never mix: switching to local signs out of the account first,
 * and the local diary keeps its own id, keys, preferences and biometric
 * check. Switching back leaves the local diary on the phone for next time.
 */
import { IS_ANDROID_APP } from "@/lib/platform";
import { newLocalDiaryId } from "@/lib/store/records";

export type AppMode = "cloud" | "local";

const MODE_KEY = "privatediary:mode:v1";
const LOCAL_DIARY_KEY = "privatediary:local-diary:v1";

export function readDeviceMode(): AppMode {
  if (!IS_ANDROID_APP) return "cloud";
  try {
    return window.localStorage.getItem(MODE_KEY) === "local" ? "local" : "cloud";
  } catch {
    return "cloud";
  }
}

export function writeDeviceMode(mode: AppMode): void {
  if (!IS_ANDROID_APP) return;
  try {
    if (mode === "local") window.localStorage.setItem(MODE_KEY, "local");
    else window.localStorage.removeItem(MODE_KEY);
  } catch {
    // Storage blocked: the mode simply doesn't survive a restart.
  }
}

/** The local diary's id on this phone if one was ever started, without creating one. */
export function existingLocalDiaryId(): string | null {
  try {
    const existing = window.localStorage.getItem(LOCAL_DIARY_KEY);
    return existing && /^local-[0-9a-f]{24}$/.test(existing) ? existing : null;
  } catch {
    return null;
  }
}

/** The local diary's id on this phone, created the first time it's asked for. */
export function localDiaryId(): string {
  try {
    const existing = existingLocalDiaryId();
    if (existing) return existing;
    const id = newLocalDiaryId();
    window.localStorage.setItem(LOCAL_DIARY_KEY, id);
    return id;
  } catch {
    return newLocalDiaryId();
  }
}

/** After the local diary was erased: the next one gets a new id (and a fresh biometric check). */
export function forgetLocalDiaryId(): void {
  try {
    window.localStorage.removeItem(LOCAL_DIARY_KEY);
  } catch {
    // Nothing stored.
  }
}
