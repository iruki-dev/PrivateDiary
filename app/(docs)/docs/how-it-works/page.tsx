import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "일기가 보호되는 방식",
  description: "PrivateDiary는 일기를 기기에서 암호화한 뒤 저장합니다. 무엇이 보호되고 서버는 무엇을 알 수 있는지 설명합니다.",
};

export default function HowItWorksPage() {
  return (
    <>
      <h1>일기가 보호되는 방식</h1>
      <p className="doc-lead">
        일기는 이 기기에서 암호화된 뒤에 저장됩니다. 서버에는 일기를 열 수 있는 열쇠가 없습니다.
      </p>

      <h2 id="encryption">기기에서 암호화합니다</h2>
      <p>
        저장 버튼을 누르면 일기 본문은 브라우저 안에서 암호화되고, 서버에는 암호문만 전송됩니다.
        계정마다 고유한 열쇠가 있으며, 이 열쇠는 일기 암호로 잠긴 상태로만 서버에 보관됩니다. 일기
        암호는 어디로도 전송되지 않으므로 서버는 이 열쇠를 풀 수 없습니다.
      </p>
      <p>
        일기를 <strong>쓸 때</strong>는 잠그는 데 필요한 공개 정보만 쓰기 때문에 일기 암호가 필요
        없습니다. 일기를 <strong>읽을 때</strong>만 일기 암호로 열쇠를 풉니다.
      </p>

      <h2 id="length">글의 길이도 감춥니다</h2>
      <p>
        암호문의 크기는 원래 글의 길이를 드러낼 수 있습니다. 그래서 저장하기 전에 글을 일정한 크기
        단위로 채웁니다. 한글 수백 자 이하의 짧은 일기는 모두 같은 크기로 저장되고, 긴 일기도 대략적인
        범위만 드러납니다.
      </p>

      <h2 id="server-knows">서버가 알 수 있는 것과 없는 것</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">서버가 알 수 없는 것</th>
            <th scope="col">서버가 알 수 있는 것</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>일기 내용</td>
            <td>로그인에 쓰는 이메일 주소</td>
          </tr>
          <tr>
            <td>일기 암호와 백업 코드</td>
            <td>일기를 저장한 시각과 개수</td>
          </tr>
          <tr>
            <td>검색어 (검색은 기기 안에서만 합니다)</td>
            <td>자동 잠금 시간 같은 설정값</td>
          </tr>
          <tr>
            <td>짧은 일기의 길이</td>
            <td>2단계 인증(OTP) 사용 여부</td>
          </tr>
        </tbody>
      </table>

      <h2 id="algorithms">사용하는 암호 기술</h2>
      <ul>
        <li>본문 암호화: AES-256-GCM</li>
        <li>
          열쇠 교환: X25519와 ML-KEM-768을 함께 쓰는 하이브리드 방식. ML-KEM은 양자 컴퓨터로도 풀기
          어렵도록 설계된 표준 알고리즘입니다.
        </li>
        <li>일기 암호로 열쇠 잠그기: PBKDF2-SHA256, 600,000회 반복</li>
        <li>백업 코드: Shamir 비밀 분산</li>
      </ul>

      <h2 id="limits">보호할 수 없는 것</h2>
      <ul>
        <li>
          기기 자체가 악성 프로그램에 감염되었거나, 악성 브라우저 확장 프로그램이 설치되어 있으면 화면에
          보이는 내용과 입력하는 암호를 지킬 수 없습니다. PrivateDiary는 암호화 기능이 변조된 것을
          감지하면 일기장 열기와 저장을 막지만, 모든 경우를 잡아낼 수는 없습니다.
        </li>
        <li>잠금이 풀린 화면을 다른 사람이 보는 것은 막을 수 없습니다. 자리를 비울 때는 잠가 주세요.</li>
        <li>
          내보내기로 받은 파일은 암호화되지 않은 일반 텍스트입니다. 보관에 주의해 주세요.
        </li>
      </ul>

      <h2 id="source">소스 코드</h2>
      <p>
        PrivateDiary의 소스 코드는 <a href={SITE.repositoryUrl}>GitHub</a>에 공개되어 있습니다. 일기가
        실제로 기기에서 암호화되는지 누구나 확인할 수 있습니다. 더 알고 싶은 점은{" "}
        <Link href="/docs/passphrase">일기 암호</Link>와 <Link href="/docs/backup-codes">백업 코드</Link>{" "}
        문서를 참고하세요.
      </p>
    </>
  );
}
