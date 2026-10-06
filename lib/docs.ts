/**
 * Table of contents for the help docs (app/(docs)). The service screens
 * keep their own copy to a label and at most one line, and link here with
 * "자세히" for anything that needs explaining — this list is the single
 * place those links resolve against.
 */

export interface DocPage {
  href: string;
  title: string;
  summary: string;
}

export interface DocGroup {
  title: string;
  pages: DocPage[];
}

export const DOC_GROUPS: DocGroup[] = [
  {
    title: "시작하기",
    pages: [
      { href: "/docs/getting-started", title: "시작하기", summary: "가입부터 첫 일기까지, 그리고 홈 화면에 추가하기" },
    ],
  },
  {
    title: "보안",
    pages: [
      { href: "/docs/how-it-works", title: "일기가 보호되는 방식", summary: "무엇이 암호화되고 서버는 무엇을 알 수 있는지" },
      { href: "/docs/passphrase", title: "일기 암호와 로그인 비밀번호", summary: "두 비밀의 차이, 바꾸는 법, 잊었을 때" },
      { href: "/docs/backup-codes", title: "백업 코드", summary: "일기 암호를 잊었을 때를 위한 비상 열쇠" },
      { href: "/docs/otp", title: "2단계 인증 (OTP)", summary: "일기를 열기 전에 인증 앱 코드를 한 번 더 확인" },
    ],
  },
  {
    title: "사용하기",
    pages: [
      { href: "/docs/writing", title: "일기 쓰기", summary: "저장, 임시 저장, 쓰는 글 가리기, 하루에 쓸 수 있는 일기" },
      { href: "/docs/reading", title: "일기장", summary: "열기, 자동 잠금, 달력, 검색, 내보내기" },
      { href: "/docs/account", title: "계정 관리", summary: "비밀번호 재설정, 로그아웃, 계정 삭제" },
      { href: "/docs/android", title: "Android 앱", summary: "생체 인증(추가 확인)과 휴대폰에서 일기를 지키는 장치" },
    ],
  },
  {
    title: "정책",
    pages: [
      { href: "/privacy", title: "개인정보처리방침", summary: "수집하는 정보와 처리 방식" },
      { href: "/terms", title: "이용약관", summary: "서비스 이용 조건" },
    ],
  },
];

export const ALL_DOC_PAGES: DocPage[] = DOC_GROUPS.flatMap((group) => group.pages);

/** Previous/next pages in reading order, for the links at the bottom of each doc. */
export function docNeighbours(href: string): { prev: DocPage | null; next: DocPage | null } {
  const index = ALL_DOC_PAGES.findIndex((page) => page.href === href);
  if (index === -1) return { prev: null, next: null };
  return {
    prev: ALL_DOC_PAGES[index - 1] ?? null,
    next: ALL_DOC_PAGES[index + 1] ?? null,
  };
}
