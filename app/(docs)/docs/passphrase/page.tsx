import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "일기 암호와 로그인 비밀번호",
  description: "PrivateDiary의 두 가지 비밀, 로그인 비밀번호와 일기 암호의 차이와 관리 방법.",
};

export default function PassphrasePage() {
  return (
    <>
      <h1>일기 암호와 로그인 비밀번호</h1>
      <p className="doc-lead">PrivateDiary에는 비밀이 두 가지 있고, 하는 일이 다릅니다.</p>

      <table>
        <thead>
          <tr>
            <th scope="col"></th>
            <th scope="col">로그인 비밀번호</th>
            <th scope="col">일기 암호</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="font-medium">하는 일</th>
            <td>계정에 로그인</td>
            <td>일기 열기</td>
          </tr>
          <tr>
            <th scope="row" className="font-medium">서버로 전송</th>
            <td>예 (로그인 확인용)</td>
            <td>아니요</td>
          </tr>
          <tr>
            <th scope="row" className="font-medium">잊었을 때</th>
            <td>이메일로 재설정</td>
            <td>백업 코드로만 새로 설정</td>
          </tr>
        </tbody>
      </table>
      <p>
        Google 계정으로 가입했다면 로그인 비밀번호 대신 Google 로그인을 쓰고, 일기 암호는 똑같이
        따로 정합니다.
      </p>

      <h2 id="why-two">왜 따로 있나요</h2>
      <p>
        로그인은 서버가 &ldquo;당신이 맞는지&rdquo; 확인하는 절차라서, 로그인 비밀번호는 서버가 다룰 수밖에
        없습니다. 일기를 여는 열쇠까지 같은 비밀로 잠그면 서버가 일기를 열 수 있게 됩니다. 그래서 일기
        암호는 서버에 보내지 않는 별도의 비밀로 두고, 로그인 비밀번호와 같은 값은 쓸 수 없게 했습니다.
      </p>

      <h2 id="choosing">좋은 일기 암호</h2>
      <ul>
        <li>서로 관련 없는 단어 여러 개를 이어 붙이면 기억하기 쉽고 추측하기 어렵습니다.</li>
        <li>이름, 생일, 이메일 주소처럼 남이 알 수 있는 정보는 피하세요.</li>
        <li>입력하는 동안 강도가 표시되며, 너무 약한 암호는 쓸 수 없습니다.</li>
      </ul>

      <h2 id="change">일기 암호 바꾸기</h2>
      <p>
        설정의 <strong>암호 변경</strong>에서 기존 암호를 입력하고 새 암호를 정합니다. 이미 쓴 일기와
        발급한 백업 코드는 그대로 쓸 수 있습니다.
      </p>

      <h2 id="forgot">일기 암호를 잊었을 때</h2>
      <p>
        <Link href="/docs/backup-codes">백업 코드</Link>가 있다면, 로그인한 뒤 설정의{" "}
        <strong>암호를 잊으셨나요?</strong>에서 백업 코드를 입력하고 새 암호를 정할 수 있습니다.
      </p>
      <p className="doc-note">
        일기 암호와 백업 코드를 모두 잃으면 누구도 일기를 열 수 없습니다. 같은 이유로 계정 삭제도 할 수
        없게 됩니다. 계정 삭제에는 일기 암호나 백업 코드로 본인임을 확인하는 절차가 있기 때문입니다.
      </p>

      <h2 id="login-password">로그인 비밀번호를 잊었을 때</h2>
      <p>
        로그인 화면의 <strong>로그인 비밀번호를 잊으셨나요?</strong>에서 재설정 링크를 받을 수 있습니다.
        로그인 비밀번호를 바꿔도 일기 암호는 바뀌지 않습니다.
      </p>
    </>
  );
}
