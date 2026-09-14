"use client";

import { useSecurity } from "@/contexts/SecurityContext";

/**
 * Renders at the top of every page (app/layout.tsx, above NavBar) so a
 * security signal is visible no matter which route the user is on —
 * including ones that never call a guarded crypto function this session
 * (see lib/security/nativeIntegrity.ts's assertNativeIntegrity() call
 * sites), which would otherwise leave tampering completely invisible
 * until the user happened to try to unlock or write an entry.
 *
 * Two tiers, matching lib/security's split:
 *  - Tampered APIs: NOT dismissable. This is the one signal this app can
 *    actually act on (assertNativeIntegrity() refuses to unlock/write/
 *    decrypt while it's true) — hiding the banner would contradict that.
 *  - Everything else (lib/security/environmentSignals.ts): dismissable
 *    per warning kind, since each has a real non-malicious explanation
 *    often enough that forcing it to stay up would just get ignored.
 */
export function SecurityWarningBanner() {
  const { tamperedApis, warnings, dismissWarning } = useSecurity();

  if (tamperedApis.length === 0 && warnings.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 border-b border-red-300 bg-red-50 px-4 py-3 text-sm dark:border-red-900 dark:bg-red-950">
      {tamperedApis.length > 0 && (
        <div role="alert" className="flex items-start gap-2 font-medium text-red-800 dark:text-red-300">
          <span aria-hidden>⚠️</span>
          <p>
            이 브라우저 환경에서 암호화 관련 기능({tamperedApis.join(", ")})이 변조된 것으로
            감지되었습니다. 확장 프로그램(특히 최근 설치했거나 낯선 것)을 비활성화하거나, 시크릿/게스트
            모드 또는 다른 기기에서 다시 시도하세요. 이 경고가 사라지지 않는 한 잠금 해제·저장·복호화가
            차단됩니다.
          </p>
        </div>
      )}
      {warnings.map((warning) => (
        <div
          key={warning.kind}
          role="status"
          className="flex items-start gap-2 text-amber-800 dark:text-amber-400"
        >
          <span aria-hidden>ℹ️</span>
          <p className="flex-1">{warning.message}</p>
          <button
            type="button"
            onClick={() => dismissWarning(warning.kind)}
            aria-label="경고 닫기"
            className="shrink-0 text-xs underline decoration-dotted underline-offset-2"
          >
            닫기
          </button>
        </div>
      ))}
    </div>
  );
}
