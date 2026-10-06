import type { Metadata } from "next";
import type { ReactNode } from "react";

// App-only page: keep it out of search results (see app/layout.tsx).
export const metadata: Metadata = {
  title: "휴대폰에만 쓰기",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
