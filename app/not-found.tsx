import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page-center flex-col gap-3 text-center">
      <h1 className="text-xl font-semibold">페이지를 찾을 수 없습니다</h1>
      <p className="muted">주소가 잘못되었거나 더 이상 존재하지 않는 페이지입니다.</p>
      <Link href="/" className="btn-primary mt-2">
        홈으로
      </Link>
    </main>
  );
}
