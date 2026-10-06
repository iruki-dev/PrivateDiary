"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthContext";
import { isNativeApp, nativeHello, onNativeEvent, type NativeHello } from "@/lib/native/bridge";
import { reportReady, reportRoute } from "@/lib/native/app";

/**
 * What the Android app around this page can do, plus the bits of app state
 * the page reacts to. On the website this stays at its defaults and never
 * does anything.
 *
 * Also the page's half of the app's lifecycle handshake: it tells the app
 * when it has rendered (so the splash screen can go) and which route it is
 * on (so the app can allow password managers on the sign-in pages only).
 */
interface NativeContextValue {
  /** Null until the app answers, and always on the website. */
  hello: NativeHello | null;
  /** The on-screen keyboard is up (the app shrinks the page to sit above it). */
  keyboardOpen: boolean;
}

const NativeContext = createContext<NativeContextValue>({ hello: null, keyboardOpen: false });

export function NativeProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const pathname = usePathname();
  const [hello, setHello] = useState<NativeHello | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    void nativeHello().then((answer) => {
      if (cancelled || !answer) return;
      setHello(answer);
      setKeyboardOpen(answer.keyboardOpen);
    });
    const unsubscribe = onNativeEvent("keyboard", (data) => setKeyboardOpen(data.open === true));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isNativeApp()) reportRoute(pathname);
  }, [pathname]);

  // Signed-in or not is what decides the first screen; hold the splash
  // until that's known and one frame has been painted.
  useEffect(() => {
    if (!isNativeApp() || status === "loading") return;
    const frame = requestAnimationFrame(() => reportReady());
    return () => cancelAnimationFrame(frame);
  }, [status]);

  return <NativeContext.Provider value={{ hello, keyboardOpen }}>{children}</NativeContext.Provider>;
}

export function useNative(): NativeContextValue {
  return useContext(NativeContext);
}
