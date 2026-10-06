/**
 * Which passphrase fields are on screen right now, so the Android app can
 * keep Android's autofill (Google Password Manager, Samsung Pass, any
 * third-party password manager) away from them.
 *
 * The diary passphrase is never stored anywhere — not by this app, and it
 * must not be by a password manager either. Autofill is the one path by
 * which a typed value can leave the page for another app's storage, so
 * every passphrase field holds a block while mounted
 * (components/PasswordField.tsx), and contexts/NativeContext.tsx allows
 * autofill only on the sign-in pages when no block is held.
 */
let blocks = 0;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

/** Holds a block until the returned function is called (once). */
export function blockAutofill(): () => void {
  blocks += 1;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    blocks -= 1;
    notify();
  };
}

export function isAutofillBlocked(): boolean {
  return blocks > 0;
}

export function subscribeAutofillBlocks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Login password fields only, and never next to a passphrase field. */
export function autofillAllowed(pathname: string, blocked: boolean): boolean {
  return !blocked && (pathname === "/login" || pathname === "/signup");
}
