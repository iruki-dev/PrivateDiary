import type { Metadata } from "next";
import Link from "next/link";
import { SITE, contactHref, contactLabel } from "@/lib/site";

export const metadata: Metadata = {
  title: "이용약관",
  description: "PrivateDiary 서비스 이용 조건.",
};

export default function TermsPage() {
  return (
    <>
      <h1>이용약관</h1>
      <p className="doc-lead">
        이 약관은 {SITE.operatorName}(이하 &ldquo;운영자&rdquo;)가 제공하는 {SITE.name}(이하
        &ldquo;서비스&rdquo;)의 이용 조건을 정합니다.
      </p>

      <h2 id="service">제1조 서비스</h2>
      <p>
        서비스는 이용자가 쓴 일기를 이용자의 기기에서 암호화해 저장하고, 이용자가 자신의 기기에서 다시
        열어 볼 수 있게 하는 웹 일기장입니다.
      </p>

      <h2 id="account">제2조 계정</h2>
      <ol>
        <li>이용자는 이메일 또는 Google 계정으로 가입할 수 있으며, 가입 시 이 약관과 개인정보처리방침에 동의한 것으로 봅니다.</li>
        <li>이용자는 자신의 로그인 정보를 다른 사람이 쓰지 않도록 관리해야 합니다.</li>
      </ol>

      <h2 id="secrets">제3조 일기 암호와 백업 코드</h2>
      <ol>
        <li>
          일기 암호와 백업 코드는 이용자의 기기 밖으로 전송되지 않으며, 운영자는 이를 알거나 보관하지
          않습니다.
        </li>
        <li>
          이용자가 일기 암호와 백업 코드를 모두 잃어버리면 운영자를 포함한 누구도 일기를 복구할 수
          없습니다. 이용자는 이 점을 이해하고 이를 스스로 관리해야 합니다.
        </li>
        <li>저장한 일기는 수정하거나 개별 삭제할 수 없습니다. 계정을 삭제하면 모든 일기가 함께 삭제됩니다.</li>
      </ol>

      <h2 id="prohibited">제4조 금지 행위</h2>
      <p>이용자는 다음 행위를 해서는 안 됩니다.</p>
      <ul>
        <li>다른 사람의 계정을 무단으로 이용하는 행위</li>
        <li>서비스의 정상적인 운영을 방해하거나 자동화된 수단으로 과도한 요청을 보내는 행위</li>
        <li>법령을 위반하는 행위</li>
      </ul>

      <h2 id="changes">제5조 서비스의 변경과 중단</h2>
      <p>
        운영자는 서비스의 내용을 바꾸거나 제공을 중단할 수 있습니다. 서비스 제공을 종료하는 경우 최소
        30일 전에 알리며, 이용자가 그 기간 안에 일기를 <Link href="/docs/reading#export">내보내기</Link>로
        받을 수 있도록 합니다.
      </p>

      <h2 id="termination">제6조 탈퇴</h2>
      <p>
        이용자는 언제든 설정의 계정 삭제로 탈퇴할 수 있습니다. 탈퇴하면 모든 일기와 계정 정보가 즉시
        삭제되며 되돌릴 수 없습니다.
      </p>

      <h2 id="liability">제7조 책임의 제한</h2>
      <ol>
        <li>
          운영자는 이용자가 일기 암호와 백업 코드를 잃어버려 일기를 열 수 없게 된 데 대해 책임지지
          않습니다.
        </li>
        <li>
          운영자는 천재지변, 클라우드 서비스 제공자의 장애 등 운영자가 통제할 수 없는 사유로 서비스를
          제공하지 못한 데 대해 책임지지 않습니다. 다만 운영자의 고의나 중대한 과실이 있는 경우에는
          그렇지 않습니다.
        </li>
      </ol>

      <h2 id="law">제8조 준거법</h2>
      <p>이 약관은 대한민국 법령에 따라 해석됩니다.</p>

      <h2 id="contact">문의</h2>
      <p>
        <a href={contactHref()}>{contactLabel()}</a>
      </p>

      <p className="doc-meta">시행일: {SITE.policyEffectiveDate}</p>
    </>
  );
}
