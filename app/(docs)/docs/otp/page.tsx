import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "OTP 인증",
  description: "일기를 열기 전에 인증 앱의 코드를 한 번 더 확인하는 PrivateDiary OTP 인증 안내.",
};

export default function OtpPage() {
  return (
    <>
      <h1>OTP 인증</h1>
      <p className="doc-lead">
        켜 두면 일기를 열거나 보안 설정을 바꾸기 전에 인증 앱의 6자리 코드를 한 번 더 확인합니다.
      </p>

      <h2 id="what">무엇을 지켜 주나요</h2>
      <p>
        누군가 당신의 로그인을 가로채더라도, 인증 앱이 없으면 저장된 일기(암호문)를 불러오거나 보안
        설정을 바꿀 수 없습니다. OTP는 서버가 확인하는 추가 관문이며, 일기를 암호화하는 열쇠와는
        별개입니다. 일기 내용은 OTP와 상관없이 항상 일기 암호로 보호됩니다.
      </p>

      <h2 id="enable">켜기</h2>
      <ol>
        <li>설정의 <strong>OTP 인증</strong>에서 켜기를 누릅니다.</li>
        <li>일기 암호를 입력해 본인임을 확인합니다. 로그인한 지 오래되었다면 다시 로그인을 요청합니다.</li>
        <li>Google Authenticator 같은 인증 앱으로 QR 코드를 스캔합니다.</li>
        <li>앱에 표시된 코드를 입력하면 켜집니다.</li>
      </ol>

      <h2 id="using">사용하기</h2>
      <ul>
        <li>한 번 인증하면 12시간 동안 다시 묻지 않습니다.</li>
        <li>코드를 5번 틀리면 1분 동안 입력할 수 없습니다.</li>
        <li>OTP를 끄려면 현재 코드가 필요합니다.</li>
      </ul>

      <h2 id="lost-device">인증 앱이 있는 기기를 잃어버렸다면</h2>
      <p>
        <Link href="/docs/backup-codes">백업 코드</Link>로 일기를 열면 OTP 코드 없이 접근할 수 있고, 그 뒤
        12시간 동안 설정도 바꿀 수 있습니다. 다만 OTP 끄기와 계정 삭제에는 OTP 코드가 반드시 필요합니다.
        인증 앱의 백업 기능을 함께 켜 두는 것을 권장합니다.
      </p>
    </>
  );
}
