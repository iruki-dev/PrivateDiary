"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { signOut } from "@/lib/firebase/auth";
import { SettingsGroup, SettingsLinkRow, SettingsRow } from "@/components/settings/ui";
import { useNative } from "@/contexts/NativeContext";
import { docHref } from "@/lib/site";

/**
 * Who is signed in, the help docs, and sign-out — the occasional account
 * actions that used to sit in the top menu. Rendered outside /settings'
 * OTP gate: signing out must never require an OTP code.
 */
export function AccountGroup() {
  const { user } = useAuth();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const usesGoogle = user?.providerData.some((p) => p.providerId === "google.com") ?? false;
  // Android app: which build this is, for bug reports from testers.
  const { hello } = useNative();

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    router.replace("/login");
  }

  return (
    <SettingsGroup id="account" title="계정">
      <SettingsRow
        label={user?.email ?? "로그인됨"}
        description={usesGoogle ? "Google 계정으로 로그인" : "이메일로 로그인"}
      />
      <SettingsLinkRow href={docHref("/docs")} label="도움말" />
      {hello && (
        <SettingsRow
          label="앱 버전"
          description={
            <span className="tabular-nums">
              {hello.version} ({hello.versionCode}) · {hello.commit}
            </span>
          }
        />
      )}
      <SettingsRow
        label="로그아웃"
        description="이 기기의 임시 저장본도 함께 지워집니다."
        control={
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="btn-secondary btn-sm"
          >
            {signingOut ? "로그아웃 중..." : "로그아웃"}
          </button>
        }
      />
    </SettingsGroup>
  );
}
