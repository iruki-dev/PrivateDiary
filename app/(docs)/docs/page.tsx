import type { Metadata } from "next";
import Link from "next/link";
import { DOC_GROUPS } from "@/lib/docs";

export const metadata: Metadata = {
  title: "도움말",
  description: "PrivateDiary 사용법과 일기가 보호되는 방식에 대한 안내입니다.",
};

export default function DocsIndexPage() {
  return (
    <>
      <h1>도움말</h1>
      <p className="doc-lead">PrivateDiary 사용법과 일기가 보호되는 방식을 설명합니다.</p>
      {DOC_GROUPS.map((group) => (
        <section key={group.title}>
          <h2>{group.title}</h2>
          <ul className="!list-none !pl-0 !space-y-0 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {group.pages.map((page) => (
              <li key={page.href}>
                <Link href={page.href} className="block py-3 !no-underline hover:!opacity-100 group">
                  <span className="font-medium group-hover:underline">{page.title}</span>
                  <span className="faint block text-sm">{page.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
