"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "@/contexts/AccountContext";
import { reauthenticateWithPassword, signOut } from "@/lib/firebase/auth";
import { authErrorCode } from "@/lib/firebase/authErrors";
import { getRecoveryEmail, OtpRequiredError, setRecoveryEmail } from "@/lib/firebase/profile";
import { ReauthRequiredError } from "@/lib/firebase/reauth";
import { isPlausibleEmail, loginIdFromEmail, nicknameProblem, normalizeNickname, NICKNAME_MAX_LENGTH } from "@/lib/loginId";
import { SettingsGroup, SettingsLinkRow, SettingsRow } from "@/components/settings/ui";
import { FormError, PanelActions, ReauthPanel } from "@/components/settings/forms";
import { TextField } from "@/components/PasswordField";
import { useNative } from "@/contexts/NativeContext";
import { docHref } from "@/lib/site";

/**
 * Who is signed in, the help docs, and sign-out — the occasional account
 * actions that used to sit in the top menu. Rendered outside /settings'
 * OTP gate: signing out must never require an OTP code.
 *
 * Also the account's name (nickname) and, for id accounts, the email a
 * login-password reset link goes to (lib/firebase/profile.ts).
 */
export function AccountGroup() {
  const { account, store, closeBackup } = useAccount();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  // Android app: which build this is, for bug reports from testers.
  const { hello } = useNative();

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    router.replace("/login");
  }

  const versionRow = hello && (
    <SettingsRow
      label="앱 버전"
      description={
        <span className="tabular-nums">
          {hello.version} ({hello.versionCode}) · {hello.commit}
        </span>
      }
    />
  );

  if (account?.kind === "backup") {
    return (
      <SettingsGroup id="account" title="계정">
        <SettingsRow
          label="휴대폰 백업을 보고 있어요"
          description={`${account.label} · 읽기만 할 수 있어요`}
          control={
            <button type="button" onClick={closeBackup} className="btn-secondary btn-sm">
              백업 닫기
            </button>
          }
        />
        <SettingsLinkRow href={docHref("/docs")} label="도움말" />
        {versionRow}
      </SettingsGroup>
    );
  }

  const user = account?.kind === "cloud" ? account.user : null;
  const usesGoogle = user?.providerData.some((p) => p.providerId === "google.com") ?? false;
  const loginId = loginIdFromEmail(user?.email);
  const signedInAs =
    account?.kind === "local"
      ? "이 휴대폰에만 있는 일기장이에요"
      : usesGoogle
        ? `Google 계정${user?.email ? `(${user.email})` : ""}으로 로그인했어요`
        : loginId
          ? `아이디 ${loginId}로 로그인했어요`
          : `이메일 ${user?.email ?? ""}로 로그인했어요`;

  return (
    <SettingsGroup id="account" title="계정">
      {store && <NicknameRow key={store.ownerId} description={signedInAs} />}
      {user && loginId && <RecoveryEmailRow key={user.uid} />}
      <SettingsLinkRow href={docHref("/docs")} label="도움말" />
      {versionRow}
      {account?.kind === "cloud" && (
        <SettingsRow
          label="로그아웃"
          description="이 기기에 임시 저장한 글도 함께 지워요"
          control={
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              className="btn-secondary btn-sm"
            >
              {signingOut ? "로그아웃하는 중…" : "로그아웃"}
            </button>
          }
        />
      )}
    </SettingsGroup>
  );
}

function NicknameRow({ description }: { description: string }) {
  const { store } = useAccount();
  const [nickname, setNickname] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    store
      .getNickname()
      .then((value) => {
        if (!cancelled) setNickname(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [store]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!store) return;
    const name = normalizeNickname(draft);
    const problem = nicknameProblem(name);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await store.setNickname(name);
      setNickname(name);
      setEditing(false);
    } catch (err) {
      console.error("setNickname failed", err);
      setError("닉네임을 저장하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsRow
      label={nickname ?? "닉네임을 정해 주세요"}
      description={description}
      control={
        !editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(nickname ?? "");
              setError(null);
              setEditing(true);
            }}
            className="btn-secondary btn-sm"
          >
            {nickname ? "닉네임 바꾸기" : "닉네임 정하기"}
          </button>
        )
      }
    >
      {editing && (
        <form onSubmit={(event) => void save(event)} className="space-y-3">
          <TextField
            label="닉네임"
            autoComplete="nickname"
            autoFocus
            maxLength={NICKNAME_MAX_LENGTH}
            value={draft}
            onChange={setDraft}
          />
          <FormError>{error}</FormError>
          <PanelActions submitLabel="저장" busyLabel="저장하는 중…" busy={busy} onCancel={() => setEditing(false)} />
        </form>
      )}
    </SettingsRow>
  );
}

type RecoveryPhase = "idle" | "editing" | "reauth";

/**
 * Id accounts only: where a login-password reset link goes. Recommended,
 * never required. Changing it needs a fresh login (or 2-step verification)
 * — the address decides who can reset the login — so this row re-asks
 * for the login password when the server says so, then retries.
 */
function RecoveryEmailRow() {
  const { account } = useAccount();
  const user = account?.kind === "cloud" ? account.user : null;
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [phase, setPhase] = useState<RecoveryPhase>("idle");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getRecoveryEmail(user.uid)
      .then((value) => {
        if (!cancelled) setEmail(value);
      })
      .catch(() => {
        if (!cancelled) setEmail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function apply(next: string | null) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await setRecoveryEmail(next);
      setEmail(next);
      setPhase("idle");
      setPending(null);
      setMessage(next ? "재설정용 이메일을 저장했어요" : "재설정용 이메일을 지웠어요");
    } catch (err) {
      if (err instanceof ReauthRequiredError) {
        setPending(next);
        setPhase("reauth");
      } else if (err instanceof OtpRequiredError) {
        setError("2단계 인증을 먼저 해 주세요. 위의 설정을 열 때 인증 앱의 숫자를 넣으면 바꿀 수 있어요.");
      } else {
        console.error("setRecoveryEmail failed", err);
        setError("저장하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draft.trim();
    if (!isPlausibleEmail(next)) {
      setError("이메일 주소를 다시 확인해 주세요.");
      return;
    }
    await apply(next);
  }

  async function reauth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await reauthenticateWithPassword(user, password);
      setPassword("");
    } catch (err) {
      const code = authErrorCode(err);
      setError(
        code === "auth/invalid-credential" || code === "auth/wrong-password"
          ? "로그인 비밀번호를 다시 확인해 주세요."
          : "다시 로그인하지 못했어요. 다시 시도해 주세요."
      );
      setBusy(false);
      return;
    }
    setBusy(false);
    await apply(pending);
  }

  if (email === undefined) return null;

  return (
    <SettingsRow
      label="비밀번호 재설정용 이메일"
      description={
        <>
          <span className={email ? "" : "text-warn"}>
            {email ?? "아직 없어요 · 넣어 두면 로그인 비밀번호를 잊었을 때 다시 정할 수 있어요"}
          </span>
          {message && <span className="mt-1 block text-ink">{message}</span>}
        </>
      }
      control={
        phase === "idle" && (
          <button
            type="button"
            onClick={() => {
              setDraft(email ?? "");
              setError(null);
              setMessage(null);
              setPhase("editing");
            }}
            className="btn-secondary btn-sm"
          >
            {email ? "바꾸기" : "넣기"}
          </button>
        )
      }
    >
      {phase === "editing" && (
        <form onSubmit={(event) => void submit(event)} className="space-y-3">
          <TextField
            label="이메일"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            value={draft}
            onChange={setDraft}
            placeholder="name@example.com"
            hint="로그인 비밀번호 재설정 링크를 받을 때만 써요."
          />
          <FormError>{error}</FormError>
          <PanelActions submitLabel="저장" busyLabel="저장하는 중…" busy={busy} onCancel={() => setPhase("idle")} />
          {email && (
            <button type="button" onClick={() => void apply(null)} disabled={busy} className="btn-text w-full text-danger">
              재설정용 이메일 지우기
            </button>
          )}
        </form>
      )}
      {phase === "reauth" && (
        <ReauthPanel
          reason="재설정용 이메일을 바꾸려면 로그인 비밀번호를 한 번 더 넣어 주세요."
          isGoogleAccount={false}
          password={password}
          onPasswordChange={setPassword}
          onSubmitPassword={(event) => void reauth(event)}
          // Id accounts always have a login password; there's no Google path here.
          onGoogle={() => {}}
          busy={busy}
          error={error}
          onCancel={() => {
            setPhase("idle");
            setPassword("");
            setPending(null);
            setError(null);
          }}
        />
      )}
      {phase === "idle" && <FormError>{error}</FormError>}
    </SettingsRow>
  );
}
