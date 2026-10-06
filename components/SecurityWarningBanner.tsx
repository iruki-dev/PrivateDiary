"use client";

import { useSecurity } from "@/contexts/SecurityContext";
import { Icon } from "@/components/Icon";

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
 *    The danger colour, with a shield icon so colour isn't the only cue.
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
    <div className="flex flex-col gap-2 px-4 pt-3 sm:px-6" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
      {tamperedApis.length > 0 && (
        <div role="alert" className="mx-auto flex w-full max-w-5xl gap-3 rounded-2xl bg-danger px-4 py-3.5 text-sm leading-relaxed text-white">
          <Icon name="shield-alert" size={20} className="mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            <p className="font-bold">이 브라우저에서는 일기장을 열 수 없어요</p>
            <p>
              확장 프로그램이 보안 기능({tamperedApis.join(", ")})을 바꾼 것 같아요. 확장 프로그램을 끄거나 시크릿 창,
              다른 기기에서 열어 주세요. 그전까지는 일기를 열거나 저장할 수 없어요.
            </p>
          </div>
        </div>
      )}
      {warnings.map((warning) => (
        <div
          key={warning.kind}
          role="status"
          className="mx-auto flex w-full max-w-5xl items-start gap-3 rounded-2xl bg-warn-fill py-3 pl-4 pr-2 text-sm leading-relaxed text-warn"
        >
          <Icon name="alert" size={20} className="mt-0.5 shrink-0" />
          <p className="flex-1 py-0.5">{warning.message}</p>
          <button
            type="button"
            onClick={() => dismissWarning(warning.kind)}
            aria-label="경고 닫기"
            className="-my-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-black/5 focus:outline-none focus-visible:outline-2 focus-visible:outline-current"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      ))}
    </div>
  );
}
