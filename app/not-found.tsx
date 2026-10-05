import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <p className="faint text-sm tabular-nums">404</p>
          <h1 className="text-xl font-semibold">페이지를 찾을 수 없습니다</h1>
          <p className="muted">주소가 바뀌었거나 없는 페이지입니다.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/" className="btn-primary flex-1">
            오늘의 일기로
          </Link>
          <Link href="/docs" className="btn-secondary">
            도움말
          </Link>
        </div>
      </div>
    </main>
  );
}
