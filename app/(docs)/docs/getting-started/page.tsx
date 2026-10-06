import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "시작하기",
  description: "PrivateDiary 가입부터 첫 일기까지, 그리고 휴대폰 홈 화면에 추가하는 방법.",
};

export default function GettingStartedPage() {
  return (
    <>
      <h1>시작하기</h1>
      <p className="doc-lead">가입은 세 단계입니다. 계정을 만들고, 일기 암호를 정하고, 백업 코드를 보관합니다.</p>

      <h2 id="account">1. 계정 만들기</h2>
      <p>
        아이디·닉네임·로그인 비밀번호로 가입하거나 Google 계정으로 계속할 수 있습니다. 로그인 비밀번호는
        계정을 확인하는 데만 쓰이며, 일기를 여는 데는 쓰이지 않습니다. 로그인 비밀번호를 잊을 때를 대비해{" "}
        <Link href="/docs/account#reset-email">비밀번호 재설정용 이메일</Link>을 넣어 두길 권합니다. Android 앱에서는 계정 없이{" "}
        <Link href="/docs/android#local">이 휴대폰에만 쓰는 일기장</Link>을 만들 수도 있습니다.
      </p>

      <h2 id="passphrase">2. 일기 암호 정하기</h2>
      <p>
        일기 암호는 일기를 여는 열쇠입니다. 이 기기 밖으로 전송되지 않으므로 잊어버리면 저희도 찾아
        드릴 수 없습니다. 로그인 비밀번호와는 다른 값이어야 하고, 서로 관련 없는 단어 여러 개를
        이어 붙이면 기억하기 쉬우면서도 강한 암호가 됩니다.
      </p>
      <p>
        <Link href="/docs/passphrase">일기 암호와 로그인 비밀번호</Link>
      </p>

      <h2 id="backup-codes">3. 백업 코드 보관하기</h2>
      <p>
        백업 코드는 일기 암호를 잊었을 때 새 암호를 정할 수 있게 해 주는 비상 열쇠입니다. 여러 장으로
        나뉘어 발급되며, 정해진 장수 이상을 모아야만 쓸 수 있습니다. 서로 다른 곳에 나누어 보관하세요.
      </p>
      <p>
        <Link href="/docs/backup-codes">백업 코드</Link>
      </p>

      <h2 id="write">일기 쓰기와 읽기</h2>
      <ul>
        <li>
          <strong>쓰기</strong>는 로그인만 되어 있으면 바로 할 수 있습니다. 일기 암호를 입력할 필요가
          없습니다. <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd>로도 저장됩니다.
        </li>
        <li>
          <strong>읽기</strong>는 일기장 탭에서 일기 암호를 입력해 엽니다. 한동안 사용하지 않으면
          다시 잠깁니다.
        </li>
      </ul>

      <h2 id="install">홈 화면에 추가하기</h2>
      <p>설치할 앱은 없습니다. 홈 화면에 추가하면 주소창 없이 앱처럼 열립니다.</p>
      <table>
        <thead>
          <tr>
            <th scope="col">기기</th>
            <th scope="col">방법</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>iPhone · iPad (Safari)</td>
            <td>공유 버튼 → 홈 화면에 추가</td>
          </tr>
          <tr>
            <td>Android (Chrome)</td>
            <td>오른쪽 위 ⋮ 메뉴 → 홈 화면에 추가 또는 앱 설치</td>
          </tr>
          <tr>
            <td>컴퓨터 (Chrome · Edge)</td>
            <td>주소창 오른쪽의 설치 아이콘</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
