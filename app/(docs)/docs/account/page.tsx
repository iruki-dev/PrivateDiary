import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "계정 관리",
  description: "PrivateDiary 로그인 비밀번호 재설정, 로그아웃, 계정 삭제 안내.",
};

export default function AccountPage() {
  return (
    <>
      <h1>계정 관리</h1>

      <h2 id="reset-password">로그인 비밀번호 재설정</h2>
      <p>
        로그인 화면의 <strong>로그인 비밀번호를 잊으셨나요?</strong>에서 가입한 이메일로 재설정 링크를
        받습니다. 일기 암호는 바뀌지 않습니다.{" "}
        <Link href="/docs/passphrase">일기 암호와 로그인 비밀번호</Link>
      </p>

      <h2 id="sign-out">로그아웃</h2>
      <p>
        로그아웃하면 이 기기에 남아 있던 임시 저장본도 함께 지워집니다. 공용 기기에서는 사용 후 꼭
        로그아웃하세요.
      </p>

      <h2 id="delete">계정 삭제</h2>
      <p>
        설정 맨 아래의 <strong>계정 삭제</strong>에서 모든 일기와 계정 정보를 서버에서 영구히 삭제할 수
        있습니다. 삭제한 뒤에는 어떤 방법으로도 되돌릴 수 없으니, 남기고 싶은 일기는 먼저{" "}
        <Link href="/docs/reading#export">내보내기</Link>로 받아 두세요.
      </p>
      <p>삭제하려면 다음을 확인합니다.</p>
      <ul>
        <li>일기 암호 또는 백업 코드</li>
        <li>OTP를 켰다면 현재 OTP 코드, 아니라면 최근 로그인 (오래되었다면 다시 로그인을 요청합니다)</li>
      </ul>
      <p className="doc-note">
        로그인만 가로챈 사람이 계정을 지우지 못하도록 일기 암호나 백업 코드를 확인합니다. 그래서 둘 다
        잃어버린 경우에는 계정 삭제도 할 수 없습니다.
      </p>
    </>
  );
}
