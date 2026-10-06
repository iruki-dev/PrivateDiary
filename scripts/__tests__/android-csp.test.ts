import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildAppCsp, findCspBlockers, inlineScriptHashes, inlineScripts, internalDocLinks } from "../android-csp.mjs";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("base64");

describe("Android bundle CSP", () => {
  const page =
    '<html><head><script src="/_next/static/chunks/a.js" async=""></script></head>' +
    "<body><script>self.__next_f.push([1])</script><script>(self.__next_f=self.__next_f||[]).push([0])</script>" +
    '<script src="/_next/static/chunks/b.js"></script></body></html>';

  it("hashes exactly the inline scripts, not external ones", () => {
    expect(inlineScripts(page)).toEqual([
      "self.__next_f.push([1])",
      "(self.__next_f=self.__next_f||[]).push([0])",
    ]);
    expect(inlineScriptHashes(page)).toEqual([
      sha("self.__next_f.push([1])"),
      sha("(self.__next_f=self.__next_f||[]).push([0])"),
    ]);
  });

  it("script-src allows only self and the pinned hashes", () => {
    const csp: string = buildAppCsp(["abc="]);
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBe("script-src 'self' 'sha256-abc='");
    expect(csp).not.toMatch(/unsafe-eval|unsafe-hashes|strict-dynamic|nonce-/);
    expect(scriptSrc).not.toContain("unsafe-inline");
  });

  it("closes frames, forms, plugins and base rewriting", () => {
    const csp: string = buildAppCsp([]);
    for (const directive of [
      "frame-src 'none'",
      "form-action 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "worker-src 'none'",
    ]) {
      expect(csp).toContain(directive);
    }
  });

  it("flags anything that would need a weaker policy", () => {
    expect(findCspBlockers(page)).toEqual([]);
    expect(findCspBlockers('<button onclick="x()">a</button>')).toHaveLength(1);
    expect(findCspBlockers('<script src="https://cdn.example.com/x.js"></script>')).toHaveLength(1);
    expect(findCspBlockers('<a href="javascript:alert(1)">a</a>')).toHaveLength(1);
  });
});

describe("doc links in the Android bundle", () => {
  it("finds help/privacy/terms links that stay inside the app", () => {
    expect(internalDocLinks('<a href="/docs/otp">a</a><a href="/privacy">b</a>')).toEqual(["/docs/otp", "/privacy"]);
    expect(internalDocLinks('<a class="x" href="/docs">a</a>')).toEqual(["/docs"]);
    // RSC payloads: JSON with (sometimes escaped) quotes.
    expect(internalDocLinks('["$","a",null,{"href":"/terms","children":"t"}]')).toEqual(["/terms"]);
    expect(internalDocLinks('{\\"href\\":\\"/docs/writing#draft\\"}')).toEqual(["/docs/writing#draft"]);
  });

  it("ignores website links and other routes", () => {
    expect(internalDocLinks('<a href="https://privatediary.example/docs/otp">a</a>')).toEqual([]);
    expect(internalDocLinks('<a href="/write">a</a><a href="/docsx">b</a>')).toEqual([]);
  });
});
