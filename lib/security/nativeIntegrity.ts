/**
 * Detects a browser extension, injected script, or otherwise compromised
 * page environment that has monkey-patched the Web Crypto / data-handling
 * primitives this app's encryption depends on.
 *
 * WHY THIS EXISTS (and what it can't do): CSP (proxy.ts), Firestore rules,
 * and lib/crypto's own design all assume the JS running on the page is the
 * JS this app shipped. A malicious browser extension with a content
 * script that injects into the page's own execution context (Chrome MV3's
 * `world: "MAIN"`, or any Firefox/older-Chromium content script that
 * touches `window` directly) is NOT a same-origin script — it never has
 * to satisfy this page's CSP, because it isn't "content" the page loaded
 * at all; it's code the BROWSER injected on the user's behalf, with the
 * user's own privileges. No `Content-Security-Policy`, no Firestore rule,
 * no code this app ships can stop that from running. If it runs before
 * this module does, it can already have replaced `crypto.subtle.decrypt`
 * with something that also mails out the plaintext, and there is no way
 * for JS running AFTER that point to prove otherwise with certainty. This
 * module is explicitly a BEST-EFFORT, defense-in-depth mitigation, not a
 * guarantee — it raises the bar for the common case (an extension that
 * hooks these APIs at a normal-ish time, or does so noisily enough to
 * leave the native-code signature broken) without pretending to solve the
 * fundamentally code-unsolvable case (a sufficiently early, sufficiently
 * careful attacker already inside the page's own JS realm).
 *
 * Two independent signals, checked together:
 *
 *  1. IDENTITY: a reference to every security-critical global captured as
 *     early as this module can run (module top-level — see below for why
 *     that's not "as early as physically possible", and why that's fine).
 *     If `crypto.subtle.decrypt` no longer IS the object captured here,
 *     something replaced it.
 *  2. NATIVE-CODE SHAPE: even for a global this module's own snapshot came
 *     too late to catch untouched, a function implemented in the browser
 *     itself always stringifies to `function foo() { [native code] }` (via
 *     `Function.prototype.toString`, called through OUR captured
 *     reference to that method — an attacker who only overrides their own
 *     patched function's `.toString` doesn't defeat this, because we never
 *     call `fn.toString()`; only an attacker who additionally overrides
 *     `Function.prototype.toString` itself, AND does so before this module
 *     captures it, defeats this check — the fundamentally-unsolvable edge
 *     this file's own module doc is upfront about).
 *
 * On "as early as this module can run": this file is imported at the top
 * of contexts/Providers.tsx, itself imported at the top of the client
 * bundle's module graph — the earliest point first-party JS can run in a
 * Next.js App Router page short of an inline `<script>` (which the CSP in
 * proxy.ts deliberately keeps nonce-gated and empty of custom logic — see
 * that file's doc comment; adding tamper-detection logic there would mean
 * either weakening the CSP or duplicating this module inline, for a
 * marginal head start against an attacker this module already can't fully
 * stop). An extension whose content script runs at `document_start` can
 * still win that race; this module's job is the (large, in practice) rest
 * of the field — `document_end`/`document_idle` injections, anything
 * injected after initial load, and anything that tampers WHILE the app is
 * open, all of which the periodic re-check (contexts/SecurityContext.tsx)
 * still catches.
 */

/** Captured before anything else in this module's evaluation touches it — see the module doc's "NATIVE-CODE SHAPE" signal. */
const originalFunctionToString = Function.prototype.toString as (this: unknown) => string;

const NATIVE_CODE_PATTERN = /^\s*function\s*[^(]*\([^)]*\)\s*\{\s*\[native code\]\s*\}\s*$/;

function stringifyViaOriginal(fn: unknown): string | null {
  if (typeof fn !== "function") return null;
  try {
    return originalFunctionToString.call(fn);
  } catch {
    return null;
  }
}

/**
 * True if `fn` still looks like a browser-native implementation, using the
 * `Function.prototype.toString` reference captured at this module's own
 * load time (not whatever `Function.prototype.toString` (or `fn.toString`)
 * currently resolves to — see the module doc for why that distinction is
 * the entire point).
 */
export function isLikelyNativeFunction(fn: unknown): boolean {
  const source = stringifyViaOriginal(fn);
  return source !== null && NATIVE_CODE_PATTERN.test(source);
}

/**
 * One entry per security-critical global this module watches. `get()`
 * re-reads the live value every time (never caches it beyond the snapshot
 * below) — tampering that happens AFTER this module loads must still be
 * caught by later calls to checkNativeIntegrity().
 */
interface WatchedApi {
  name: string;
  get: () => unknown;
}

function buildWatchList(): WatchedApi[] {
  // Guarded individually — `crypto.subtle` (and everything hanging off
  // window/navigator) doesn't exist in every environment this module gets
  // imported into (SSR module evaluation, non-browser test runners), and
  // one missing global must not throw away every other check.
  const list: WatchedApi[] = [];
  const g = globalThis as typeof globalThis & {
    crypto?: Crypto;
    fetch?: typeof fetch;
    XMLHttpRequest?: typeof XMLHttpRequest;
  };

  if (g.crypto?.subtle) {
    const subtle = g.crypto.subtle;
    list.push(
      { name: "crypto.subtle.encrypt", get: () => subtle.encrypt },
      { name: "crypto.subtle.decrypt", get: () => subtle.decrypt },
      { name: "crypto.subtle.importKey", get: () => subtle.importKey },
      { name: "crypto.subtle.deriveBits", get: () => subtle.deriveBits },
      { name: "crypto.subtle.digest", get: () => subtle.digest }
    );
  }
  if (g.crypto) {
    list.push({ name: "crypto.getRandomValues", get: () => g.crypto?.getRandomValues });
  }
  list.push(
    { name: "Uint8Array", get: () => Uint8Array },
    { name: "TextEncoder.prototype.encode", get: () => TextEncoder.prototype.encode },
    { name: "TextDecoder.prototype.decode", get: () => TextDecoder.prototype.decode },
    { name: "JSON.stringify", get: () => JSON.stringify },
    { name: "JSON.parse", get: () => JSON.parse },
    { name: "Array.prototype.map", get: () => Array.prototype.map },
    { name: "Object.defineProperty", get: () => Object.defineProperty },
    { name: "Function.prototype.toString", get: () => Function.prototype.toString }
  );
  if (typeof g.fetch === "function") {
    list.push({ name: "fetch", get: () => g.fetch });
  }
  if (typeof g.XMLHttpRequest === "function") {
    list.push(
      { name: "XMLHttpRequest.prototype.open", get: () => g.XMLHttpRequest?.prototype.open },
      { name: "XMLHttpRequest.prototype.send", get: () => g.XMLHttpRequest?.prototype.send }
    );
  }
  return list;
}

let watchList: WatchedApi[] | null = null;
/** name -> the exact value observed the first time each API was checked. */
const capturedReferences = new Map<string, unknown>();

function ensureWatchListInitialized(): WatchedApi[] {
  if (!watchList) {
    watchList = buildWatchList();
  }
  return watchList;
}

export interface NativeIntegrityResult {
  ok: boolean;
  /** Names of every WatchedApi entry that failed either signal. */
  tampered: string[];
}

/**
 * Checks every watched API against its earliest-seen reference (identity)
 * and against the native-code shape (fallback signal for anything this
 * call is the first to observe). Safe and cheap to call often — intended
 * to run once at startup, again before every sensitive crypto operation,
 * and periodically in the background (contexts/SecurityContext.tsx).
 */
export function checkNativeIntegrity(): NativeIntegrityResult {
  const tampered: string[] = [];
  for (const api of ensureWatchListInitialized()) {
    let current: unknown;
    try {
      current = api.get();
    } catch {
      tampered.push(api.name);
      continue;
    }
    const previouslySeen = capturedReferences.get(api.name);
    if (previouslySeen === undefined) {
      // First observation of this API: no identity baseline yet, so the
      // native-code shape check is the only signal available. Record it
      // as the baseline for every future call regardless of outcome — an
      // API that was ALREADY tampered before this module ever loaded
      // can't un-tamper itself, and pinning the baseline here is what
      // lets a LATER swap (back to something else, or to a "better
      // disguised" hook) still be caught as a change.
      capturedReferences.set(api.name, current);
      if (typeof current === "function" && !isLikelyNativeFunction(current)) {
        tampered.push(api.name);
      }
      continue;
    }
    if (current !== previouslySeen) {
      tampered.push(api.name);
      // Deliberately NOT updating capturedReferences here: once an API is
      // known to have moved out from under us once, treating a THIRD
      // value as the new normal would help an attacker that swaps in a
      // "less suspicious" hook after this is first observed.
    }
  }
  return { ok: tampered.length === 0, tampered };
}

/** Thrown by assertNativeIntegrity() — the one place this module can actually BLOCK an operation instead of only warning about it. */
export class EnvironmentTamperedError extends Error {
  readonly tampered: string[];
  constructor(tampered: string[]) {
    super(
      `Refusing to proceed: the browser environment appears to have modified security-critical APIs (${tampered.join(", ")}).`
    );
    this.name = "EnvironmentTamperedError";
    this.tampered = tampered;
  }
}

/**
 * Guard for every call site that's about to touch plaintext or key
 * material (contexts/SeedContext.tsx's unlock/change/reset functions,
 * lib/firebase/entries.ts's writeEntry, app/entries/page.tsx's decrypt
 * loop). Throws EnvironmentTamperedError instead of proceeding — this is
 * the "block it" half of the mitigation; contexts/SecurityContext.tsx's
 * background polling is the "warn about it" half for the (likely common)
 * case where the user hasn't triggered a guarded operation yet but the
 * tampering is already detectable.
 */
export function assertNativeIntegrity(): void {
  const result = checkNativeIntegrity();
  if (!result.ok) {
    throw new EnvironmentTamperedError(result.tampered);
  }
}

// Runs once, at module-evaluation time (see the module doc for exactly how
// early that is) — establishes the identity baseline as soon as possible
// rather than waiting for the first real check call, since the whole
// point of the identity signal is catching a LATER swap against an EARLY
// baseline.
checkNativeIntegrity();
