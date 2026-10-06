import Link from "next/link";
import { docHref } from "@/lib/site";

export default function NotFound() {
  return (
    <main className="page-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <p className="faint text-sm tabular-nums">404</p>
          <h1 className="title-1">페이지를 찾을 수 없어요</h1>
          <p className="muted text-base">주소가 바뀌었거나 없는 페이지예요.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Link href="/" className="btn-primary">
            처음으로
          </Link>
          <Link href={docHref("/docs")} className="btn-secondary">
            도움말
          </Link>
        </div>
      </div>
    </main>
  );
}
