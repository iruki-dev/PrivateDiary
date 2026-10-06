"use client";

import { useNative } from "@/contexts/NativeContext";
import { IS_ANDROID_APP } from "@/lib/platform";

/**
 * Whether to offer "Google로 계속하기". Always on the web; in the Android
 * app only when the build was given the project's Google client ID
 * (android/README.md) — otherwise the button could only fail.
 */
export function useGoogleSignInAvailable(): boolean {
  const { hello } = useNative();
  return !IS_ANDROID_APP || hello?.capabilities.googleSignIn === true;
}
