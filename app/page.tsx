import type { Metadata } from "next";
import Link from "next/link";
import { SignedInRedirect } from "@/components/SignedInRedirect";
import { SiteFooter } from "@/components/SiteFooter";
import { VisitorComposer } from "@/components/VisitorComposer";
import { SITE, docHref } from "@/lib/site";
import { IS_ANDROID_APP } from "@/lib/platform";

export const metadata: Metadata = {
  title: { absolute: `${SITE.name} — ${SITE.tagline}` },
  alternates: { canonical: "/" },
};

/**
 * The front door is the product: today's diary page, ready to write in.
 * One line says what this is; everything that needs explaining lives in
 * the help docs (app/(docs)), linked once. Signed-in visitors are sent on
 * to /write, which is the same page with their account behind it.
 *
 * A Server Component, so the heading and the writing surface are in the
 * first HTML response rather than behind an auth spinner.
 */
export default function FrontPage() {
  return (
    <>
      <SignedInRedirect />
      <main className="flex flex-1 flex-col items-center px-5 pb-12 pt-6 sm:px-6 sm:py-16">
        <div className="w-full max-w-xl space-y-8">
          <header className="space-y-3">
            <h1 className="title-display">{SITE.tagline}</h1>
            <p className="muted text-base">
              일기는 이 기기에서 잠근 뒤에 저장돼요. PrivateDiary도 읽을 수 없어요.{" "}
              <Link href={docHref("/docs/how-it-works")} className="link whitespace-nowrap">
                자세히
              </Link>
            </p>
          </header>
          <VisitorComposer />
        </div>
      </main>
      {/* The app is not a website: help, privacy and terms are a tap away
          under 도움말 at the top, and on the sign-up screen. */}
      {!IS_ANDROID_APP && <SiteFooter />}
    </>
  );
}
