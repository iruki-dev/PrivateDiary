/**
 * Soft security signals — things worth warning the user about but not
 * worth blocking on, unlike nativeIntegrity.ts's tamper detection. Each of
 * these has a legitimate, non-malicious explanation often enough (a
 * developer with DevTools open, an accessibility tool that sets
 * `navigator.webdriver`, a corporate proxy that terminates TLS) that
 * refusing to unlock the diary over any one of them would break real
 * usage far more often than it stops a real attacker. They're surfaced
 * through contexts/SecurityContext.tsx as dismissible warnings instead.
 */

export type EnvironmentWarningKind =
  | "insecure-context"
  | "automation"
  | "devtools-open"
  | "device-no-screen-lock"
  | "device-rooted"
  | "device-usb-debugging";

export interface EnvironmentWarning {
  kind: EnvironmentWarningKind;
  message: string;
}

/**
 * `window.isSecureContext` is false over plain HTTP (or a broken TLS
 * chain some browsers still render as "secure enough to load" but not
 * "secure enough for powerful APIs"). `crypto.subtle` doesn't exist at all
 * outside a secure context, so this app already can't function — but the
 * failure mode without this check is a confusing crash deep inside
 * lib/crypto the first time anything calls crypto.subtle. This turns that
 * into an explicit, actionable message.
 */
function checkSecureContext(): EnvironmentWarning | null {
  if (typeof window === "undefined") return null;
  if (window.isSecureContext) return null;
  return {
    kind: "insecure-context",
    message:
      "안전한 연결(HTTPS)로 열리지 않았어요. 이대로는 일기장을 열거나 저장할 수 없고, 주고받는 내용이 노출될 수 있어요. 주소가 https://로 시작하는지 확인해 주세요.",
  };
}

/**
 * `navigator.webdriver` is set by browsers when launched under
 * WebDriver/CDP automation (Selenium, Puppeteer, Playwright, and some
 * remote-access/RAT tooling that rides on the same protocol). Real users
 * are essentially never running their own diary session this way — the
 * common false positive is a developer's own test run, which is exactly
 * why this is a dismissible warning, not a block.
 */
function checkAutomation(): EnvironmentWarning | null {
  if (typeof navigator === "undefined" || !navigator.webdriver) return null;
  return {
    kind: "automation",
    message:
      "이 브라우저가 자동화 도구(WebDriver)로 조작되고 있어요. 직접 실행한 게 아니라면 브라우저를 닫고 기기 보안을 확인해 주세요.",
  };
}

/**
 * Best-effort DevTools-open heuristic: `console.log`ing an object whose
 * `id` getter is only actually invoked when a console panel is open and
 * rendering the object's inline preview (the getter is never touched by
 * plain execution — nothing else reads `.id` on this object). Well short
 * of reliable across every browser/version and trivially avoided by
 * anyone who cares to (this is a known, publicly documented technique,
 * not a secret), so this is informational only: DevTools access means
 * whatever is in memory right now (an unlocked private key, decrypted
 * entries) is inspectable by whoever is looking at that DevTools panel,
 * which mostly matters as a "don't share your screen /  walk away right
 * now" reminder rather than a sign of compromise on its own.
 */
export function probeDevtoolsOpen(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(false);
      return;
    }
    let detected = false;
    const probe = {
      get id() {
        detected = true;
        return "";
      },
    };
    try {
      console.log("%c", probe);
    } catch {
      resolve(false);
      return;
    }
    // The getter (if it fires at all) fires synchronously inside
    // console.log's own formatting step on every browser this technique
    // works on; the timeout just yields a turn of the event loop first.
    setTimeout(() => resolve(detected), 0);
  });
}

/** Synchronous checks only — probeDevtoolsOpen is async and polled separately by SecurityContext. */
export function collectSyncEnvironmentWarnings(): EnvironmentWarning[] {
  return [checkSecureContext(), checkAutomation()].filter(
    (warning): warning is EnvironmentWarning => warning !== null
  );
}

export function devtoolsWarning(): EnvironmentWarning {
  return {
    kind: "devtools-open",
    message:
      "개발자 도구가 열려 있어요. 화면과 메모리에 있는 일기와 암호가 그대로 보일 수 있으니, 화면을 공유하거나 자리를 비우기 전에 일기장을 잠가 주세요.",
  };
}

/**
 * Android app only: soft warnings about the phone itself, reported by the
 * app (android/.../DeviceSignals.kt). Warned about, never blocked on —
 * each has an ordinary explanation (a developer's own phone has USB
 * debugging on), and root detection is easy to evade for anyone actually
 * attacking, so it's for informing the owner, not a defence.
 */
const DEVICE_WARNINGS: Record<string, EnvironmentWarning> = {
  "no-screen-lock": {
    kind: "device-no-screen-lock",
    message:
      "이 휴대폰에 화면 잠금이 없어요. 휴대폰을 든 누구나 이 앱을 열 수 있고, 생체 인증도 켤 수 없어요. 휴대폰 설정에서 화면 잠금을 켜 주세요.",
  },
  rooted: {
    kind: "device-rooted",
    message:
      "이 휴대폰은 루팅된 것 같아요. 다른 앱이 이 앱의 화면과 메모리를 볼 수 있어서 보호 장치가 제대로 동작하지 않을 수 있어요.",
  },
  "usb-debugging": {
    kind: "device-usb-debugging",
    message:
      "USB 디버깅이 켜져 있어요. 컴퓨터에 연결하면 이 휴대폰을 조작할 수 있어요. 개발 중이 아니라면 개발자 옵션에서 꺼 주세요.",
  },
};

export function deviceWarnings(signals: readonly string[]): EnvironmentWarning[] {
  return signals.flatMap((signal) => (DEVICE_WARNINGS[signal] ? [DEVICE_WARNINGS[signal]] : []));
}
