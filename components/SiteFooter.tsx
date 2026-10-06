import Link from "next/link";
import { SITE, contactHref, contactLabel, docHref } from "@/lib/site";

/** One quiet row of links at the bottom of the public pages and the docs. */
export function SiteFooter() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800">
      <nav
        aria-label="사이트 정보"
        className="faint mx-auto flex max-w-5xl flex-wrap gap-x-5 gap-y-2 px-4 py-6 text-xs sm:px-6"
      >
        <Link href={docHref("/docs")} className="hover:text-foreground">
          도움말
        </Link>
        <Link href={docHref("/privacy")} className="font-medium hover:text-foreground">
          개인정보처리방침
        </Link>
        <Link href={docHref("/terms")} className="hover:text-foreground">
          이용약관
        </Link>
        <a href={SITE.repositoryUrl} className="hover:text-foreground" rel="noopener">
          소스 코드
        </a>
        <a href={contactHref()} className="hover:text-foreground" rel="noopener">
          문의 · {contactLabel()}
        </a>
      </nav>
    </footer>
  );
}
