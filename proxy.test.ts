import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

/**
 * Phase 7 completion checklist: "CSP 위반(인라인 스크립트 삽입 시도) 시
 * 브라우저 콘솔에 차단 로그가 남는지 확인". This session has no browser
 * tool, so the actual "does the browser log a violation" step can't be
 * observed directly here — that part needs a manual check in a real
 * browser (open devtools, try injecting a `<script>` via the console, look
 * for the "Refused to execute inline script" message). What CAN be
 * verified without a browser is that the policy itself is actually strict
 * enough to trigger that block in any CSP-compliant browser — a nonce'd
 * script-src with no 'unsafe-inline' does, by construction, reject any
 * script tag that doesn't carry the exact per-request nonce, which an
 * injected/XSS'd script has no way to know in advance.
 */
describe("proxy CSP policy", () => {
  it("script-src is nonce-only, no unsafe-inline / unsafe-eval / wasm-unsafe-eval", () => {
    const response = proxy(new NextRequest("http://localhost:3000/"));
    const csp = response.headers.get("Content-Security-Policy");
    expect(csp).toBeTruthy();

    const scriptSrc = csp!.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
    expect(scriptSrc).not.toContain("wasm-unsafe-eval");
  });

  it("issues a fresh, unpredictable nonce on every request", () => {
    const a = proxy(new NextRequest("http://localhost:3000/"));
    const b = proxy(new NextRequest("http://localhost:3000/"));
    const nonceOf = (res: typeof a) =>
      res.headers.get("Content-Security-Policy")!.match(/'nonce-([^']+)'/)?.[1];

    const nonceA = nonceOf(a);
    const nonceB = nonceOf(b);
    expect(nonceA).toBeTruthy();
    expect(nonceA).not.toBe(nonceB);
  });
});

/**
 * The other half of this — that Next.js actually stamps its own inline
 * hydration <script> with the SAME nonce this emits, which is what makes
 * hydration work at all under this policy — was verified empirically
 * against a real `next build && next start`, not just asserted: curled the
 * home page, extracted the nonce from both the response's
 * Content-Security-Policy header and the inline <script nonce="..."> tags,
 * and confirmed they matched (and that the earlier fully-static build,
 * before `export const dynamic = "force-dynamic"` was added to
 * app/layout.tsx, did NOT have a nonce on those scripts at all — see the
 * Phase 6 commit message for the before/after).
 */
