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

export type EnvironmentWarningKind = "insecure-context" | "automation" | "devtools-open";

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
      "이 페이지가 안전한 연결(HTTPS)로 열리지 않았습니다. 이 상태에서는 암호화 기능이 아예 동작하지 않으며, 계속 사용할 경우 통신 내용이 가로채기당할 수 있습니다.",
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
      "이 브라우저 세션이 자동화 도구(WebDriver)로 제어되고 있는 것으로 감지되었습니다. 본인이 실행한 것이 아니라면 즉시 브라우저를 닫고 기기 보안 상태를 확인하세요.",
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
      "개발자 도구가 열려 있는 것으로 보입니다. 이 상태에서는 화면에 표시되거나 메모리에 있는 암호/일기 내용이 그대로 보일 수 있습니다. 화면 공유 중이거나 자리를 비울 예정이라면 먼저 잠금 해제를 종료하세요.",
  };
}
