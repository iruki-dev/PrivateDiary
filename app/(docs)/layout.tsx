import type { ReactNode } from "react";
import { DocsMobileToc, DocsPager, DocsSidebar } from "@/components/docs/DocsNav";
import { SiteFooter } from "@/components/SiteFooter";

/**
 * Help docs and policies. Kept apart from the service screens on purpose:
 * the app itself carries labels and one-line hints, and everything that
 * needs real explanation lives here, reachable from a "자세히" link at the
 * point it matters.
 */
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="mx-auto grid w-full max-w-5xl flex-1 gap-10 px-5 py-8 sm:px-6 sm:py-14 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <DocsSidebar />
        <div className="min-w-0">
          <DocsMobileToc />
          <article className="doc max-w-2xl rounded-3xl bg-surface px-5 py-7 sm:px-10 sm:py-10">{children}</article>
          <div className="max-w-2xl">
            <DocsPager />
          </div>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
