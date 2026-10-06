import type { Metadata } from "next";
import { SITE, contactHref, contactLabel } from "@/lib/site";

export const metadata: Metadata = {
  title: "개인정보처리방침",
  description: "PrivateDiary가 수집하는 개인정보와 처리 방식.",
};

/**
 * Covers the items 개인정보 보호법 제30조 requires a published policy to
 * state. Lists only what this codebase actually stores (Firebase Auth,
 * users/{uid}, entries, otpSecrets, Vercel request logs) — if a feature
 * starts storing something new, this page has to change with it.
 * Operator name and contact come from lib/site.ts (environment), so they
 * are set per deployment rather than hard-coded here.
 */
export default function PrivacyPage() {
  return (
    <>
      <h1>개인정보처리방침</h1>
      <p className="doc-lead">
        {SITE.operatorName}(이하 &ldquo;운영자&rdquo;)는 {SITE.name} 서비스를 제공하면서 아래와 같이
        개인정보를 처리합니다. 일기 내용은 이용자의 기기에서 암호화된 뒤 저장되므로 운영자는 그 내용을
        알 수 없으며, 따라서 이 방침이 다루는 처리 대상에도 포함되지 않습니다.
      </p>

      <h2 id="items">1. 처리하는 개인정보 항목</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">구분</th>
            <th scope="col">항목</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>계정</td>
            <td>
              이메일 주소, 로그인 비밀번호(인증 서비스가 단방향 변환해 보관), 계정 식별자, 가입·최근
              로그인 시각. Google로 가입한 경우 Google이 제공하는 이름과 프로필 사진 주소
            </td>
          </tr>
          <tr>
            <td>일기</td>
            <td>
              암호화된 일기(운영자가 내용을 볼 수 없음), 저장 시각, 저장 순번, 암호화에 쓰이는 공개키와
              일기 암호로 잠긴 열쇠
            </td>
          </tr>
          <tr>
            <td>설정</td>
            <td>
              자동 잠금 시간, 임시 저장 사용 여부, 프라이빗 작성 모드, 하루 저장 개수, 백업 코드 사용
              여부와 장수
            </td>
          </tr>
          <tr>
            <td>OTP (사용 시)</td>
            <td>OTP 생성용 비밀값, 인증 실패 횟수와 시각</td>
          </tr>
          <tr>
            <td>자동 수집</td>
            <td>서비스 접속 시 호스팅 및 인증 서비스가 남기는 IP 주소, 브라우저 정보, 접속 시각</td>
          </tr>
        </tbody>
      </table>
      <p>
        일기 암호와 백업 코드는 이용자의 기기 밖으로 전송되지 않으므로 수집하지 않습니다. 광고나 행동
        분석을 위한 추적 도구는 사용하지 않습니다.
      </p>
      <p>
        Android 앱의 생체 인증(지문·얼굴)은 휴대폰 운영체제가 처리하며, 앱과 운영자는 생체 정보를 받지
        않습니다. 앱이 확인하는 휴대폰 상태(화면 잠금, 루팅, USB 디버깅 여부)는 휴대폰 안에서 안내에만 쓰이고
        전송되지 않습니다.
      </p>

      <h2 id="purpose">2. 처리 목적</h2>
      <ul>
        <li>회원 식별과 로그인, 로그인 비밀번호 재설정</li>
        <li>암호화된 일기의 저장과 여러 기기 간 동기화</li>
        <li>OTP 인증, 하루 저장 개수 제한 등 계정 보호</li>
        <li>부정 이용 방지와 서비스 운영에 필요한 기록 관리</li>
      </ul>

      <h2 id="retention">3. 보유 기간과 파기</h2>
      <p>
        개인정보는 회원 탈퇴(계정 삭제) 시까지 보유합니다. 설정의 계정 삭제를 실행하면 일기, 계정 정보,
        OTP 비밀값, 인증 계정이 즉시 삭제됩니다. 호스팅과 인증 서비스가 자동으로 남기는 접속 기록은 각
        서비스 제공자의 보관 기간에 따라 파기됩니다. 전자적 파일은 복구할 수 없는 방법으로 삭제합니다.
      </p>

      <h2 id="third-party">4. 제3자 제공</h2>
      <p>
        운영자는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 법령에 따라 제공 의무가 생기는 경우에도
        일기는 암호화되어 있어 운영자가 그 내용을 제공할 수 없습니다.
      </p>

      <h2 id="processors">5. 처리 위탁과 국외 이전</h2>
      <p>서비스 운영을 위해 아래 업체의 클라우드 서비스를 이용하며, 이 과정에서 개인정보가 국외에 저장될 수 있습니다.</p>
      <table>
        <thead>
          <tr>
            <th scope="col">업체 (국가)</th>
            <th scope="col">위탁 업무</th>
            <th scope="col">이전 항목</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Google LLC (미국) — Firebase</td>
            <td>로그인 인증, 데이터 저장, OTP 처리</td>
            <td>1항의 계정·일기·설정·OTP 항목</td>
          </tr>
          <tr>
            <td>Vercel Inc. (미국)</td>
            <td>웹사이트 호스팅</td>
            <td>접속 기록</td>
          </tr>
        </tbody>
      </table>
      <p>
        이전 시기와 방법: 서비스 이용 시 암호화된 통신으로 전송됩니다. 보유 기간: 3항과 같습니다. 국외
        이전을 원하지 않으면 회원 탈퇴로 거부할 수 있으나, 이 경우 서비스를 이용할 수 없습니다.
      </p>

      <h2 id="rights">6. 이용자의 권리</h2>
      <p>
        이용자는 언제든 자신의 개인정보 열람, 정정, 삭제, 처리 정지를 요구할 수 있습니다. 일기는 지난
        일기 화면의 내보내기로 직접 받을 수 있고, 계정과 모든 데이터는 설정의 계정 삭제로 직접 삭제할 수
        있습니다. 그 밖의 요청은 아래 문의처로 연락해 주세요.
      </p>

      <h2 id="device">7. 이용자 기기에 저장되는 정보</h2>
      <p>
        로그인 상태 유지를 위해 브라우저 저장소에 인증 정보가 저장됩니다. 임시 저장을 켠 경우 작성 중인
        글이 해당 기기에 암호화되지 않은 상태로 저장되며, 일기를 저장하거나 로그아웃하면 삭제됩니다.
        광고·추적 목적의 쿠키는 사용하지 않습니다.
      </p>
      <p>
        Android 앱에서 생체 인증으로 열기를 켜면, 일기를 여는 열쇠가 휴대폰의 보안 하드웨어 키로 암호화되어
        앱 저장 공간에 보관됩니다. 기능을 끄거나 로그아웃하면 삭제되며, 백업이나 기기 간 이동으로 옮겨지지
        않습니다.
      </p>

      <h2 id="security">8. 안전성 확보 조치</h2>
      <ul>
        <li>일기 내용의 종단간 암호화 (운영자를 포함한 누구도 열람 불가)</li>
        <li>모든 통신 구간 암호화(HTTPS)</li>
        <li>데이터베이스 접근 규칙을 통한 계정별 접근 통제</li>
        <li>처리 목적에 필요한 최소한의 정보만 수집</li>
      </ul>

      <h2 id="officer">9. 개인정보 보호책임자</h2>
      <p>
        개인정보 보호책임자: {SITE.operatorName}
        <br />
        문의: <a href={contactHref()}>{contactLabel()}</a>
      </p>
      <p>
        개인정보 침해에 대한 신고나 상담은 개인정보침해신고센터(국번 없이 118, privacy.kisa.or.kr),
        개인정보분쟁조정위원회(1833-6972, www.kopico.go.kr)에도 할 수 있습니다.
      </p>

      <h2 id="changes">10. 방침의 변경</h2>
      <p>이 방침이 바뀌면 시행 7일 전부터 이 페이지를 통해 알립니다.</p>

      <p className="doc-meta">시행일: {SITE.policyEffectiveDate}</p>
    </>
  );
}
