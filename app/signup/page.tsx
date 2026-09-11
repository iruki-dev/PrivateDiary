"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useSeed } from "@/contexts/SeedContext";
import { signInWithGoogle, signUpWithEmail } from "@/lib/firebase/auth";
import { createUserKeyRecord } from "@/lib/firebase/users";
import { deriveHybridKeyPair, generateMasterSeed, wipeBytes, wrapSeed } from "@/lib/crypto";
import { checkPassphraseStrength } from "@/lib/passphraseStrength";
import { PassphraseStrengthMeter } from "@/components/PassphraseStrengthMeter";
import { LoadingScreen } from "@/components/LoadingState";
import { usePageTitle } from "@/hooks/usePageTitle";

/**
 * Phase 4 onboarding (ARCHITECTURE.md §3.1 step 1-5): generate the master
 * seed client-side, wrap it with a passphrase that must differ from the
 * login password and meet a minimum strength bar, then write the
 * key-issuance document. There is no other backup of the seed at this
 * point — the passphrase is the only thing that can unwrap it. Users who
 * want a secondary recovery path (recovery key or Shamir split) opt into
 * one later from /settings, which is a deliberate choice: it's the
 * account owner's call whether an extra recoverable artifact is worth
 * having versus keeping the smallest possible attack surface.
 *
 * The login password only ever lives in this component's state, only for
 * as long as it takes to compare it against the chosen passphrase — it's
 * never sent anywhere beyond the one signUpWithEmail() call that created
 * the account (ARCHITECTURE.md rule 5: login credentials and encryption
 * keys are never derived from or mixed with each other, but comparing two
 * independently-chosen values to make sure they're NOT the same is the one
 * place they briefly need to be in the same scope).
 */
export default function SignupPage() {
  const { user, status: authStatus } = useAuth();
  const { status: seedStatus, refresh } = useSeed();
  const router = useRouter();
  usePageTitle("가입");

  // --- account creation (only shown while signed out) ---
  const [email, setEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountSubmitting, setAccountSubmitting] = useState(false);
  const loginPasswordRef = useRef<string>("");

  // --- passphrase ---
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [deriving, setDeriving] = useState(false);

  useEffect(() => {
    if (seedStatus === "locked" || seedStatus === "unlocked") {
      router.replace("/");
    }
  }, [seedStatus, router]);

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccountError(null);
    setAccountSubmitting(true);
    try {
      await signUpWithEmail(email, accountPassword);
      loginPasswordRef.current = accountPassword;
      setAccountPassword("");
    } catch (err) {
      console.error("signUpWithEmail failed", err);
      setAccountError("계정을 만들지 못했습니다. 이미 가입된 이메일이거나 비밀번호가 너무 짧습니다(6자 이상).");
    } finally {
      setAccountSubmitting(false);
    }
  }

  async function handleGoogleSignUp() {
    setAccountError(null);
    setAccountSubmitting(true);
    try {
      await signInWithGoogle();
      // no login password to compare the passphrase against for this path
      loginPasswordRef.current = "";
    } catch (err) {
      console.error("signInWithGoogle failed", err);
      setAccountError("Google 가입에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setAccountSubmitting(false);
    }
  }

  async function handleSetPassphrase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPassphraseError(null);

    if (!user) return;
    if (passphrase !== passphraseConfirm) {
      setPassphraseError("암호 확인이 일치하지 않습니다.");
      return;
    }
    const userInputs = [email, user.email ?? ""].filter(Boolean);
    if (!checkPassphraseStrength(passphrase, userInputs).isStrongEnough) {
      setPassphraseError("암호가 너무 약합니다. 관련 없는 단어 6개 이상을 조합해보세요.");
      return;
    }
    if (loginPasswordRef.current && passphrase === loginPasswordRef.current) {
      setPassphraseError("로그인 비밀번호와 다른 암호를 사용해야 합니다.");
      return;
    }

    setDeriving(true);
    try {
      const seed = generateMasterSeed();
      const { publicKeys, privateKeys } = deriveHybridKeyPair(seed);
      const wrapped = await wrapSeed(seed, passphrase);
      wipeBytes(seed, privateKeys.x25519SecretKey, privateKeys.mlkem768SecretKey);

      await createUserKeyRecord(user.uid, publicKeys, wrapped);
      await refresh();
      router.replace("/");
      // Deliberately NOT clearing passphrase/passphraseConfirm here: refresh()
      // just flipped seedStatus to "locked", which re-renders this form
      // (still mounted — router.replace()'s navigation hasn't committed yet)
      // with whatever these inputs hold. Clearing them here used to cause a
      // visible flash of the now-empty form for a frame before the route
      // actually changed. Since we're navigating away regardless, leaving
      // the (soon-to-be-unmounted) values in place is harmless — only
      // loginPasswordRef needs to stop pointing at a real password.
      loginPasswordRef.current = "";
    } catch (err) {
      console.error("handleSetPassphrase failed", err);
      setPassphraseError("키를 저장하지 못했습니다. 다시 시도해주세요.");
      loginPasswordRef.current = "";
      setPassphrase("");
      setPassphraseConfirm("");
    } finally {
      setDeriving(false);
    }
  }

  if (authStatus === "loading") {
    return <LoadingScreen />;
  }

  if (authStatus === "signed-out") {
    return (
      <main className="page-center">
        <div className="w-full max-w-sm space-y-4">
          <h1 className="text-xl font-semibold">계정 만들기</h1>
          <form onSubmit={handleCreateAccount} className="space-y-4">
            <input
              type="email"
              required
              autoComplete="email"
              aria-label="이메일"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="field"
            />
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              aria-label="로그인 비밀번호"
              value={accountPassword}
              onChange={(e) => setAccountPassword(e.target.value)}
              placeholder="로그인 비밀번호"
              className="field"
            />
            {accountError && (
              <p role="alert" className="error-text">
                {accountError}
              </p>
            )}
            <button type="submit" disabled={accountSubmitting} className="btn-primary w-full">
              {accountSubmitting ? "처리 중..." : "가입하기"}
            </button>
          </form>
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <div className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
            또는
            <div className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
          </div>
          <button
            type="button"
            onClick={() => void handleGoogleSignUp()}
            disabled={accountSubmitting}
            className="btn-secondary w-full"
          >
            Google로 계속하기
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="page-center">
      <form onSubmit={handleSetPassphrase} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold">일기 암호 설정</h1>
          <p className="mt-2 muted">
            로그인 비밀번호와는 완전히 다른 값이어야 합니다. 이 암호는 서버에 전송되지
            않으며, <strong>잊어버리면 일기 내용을 복구할 방법이 없습니다.</strong> 가입 후
            설정에서 원하면 별도의 복구 수단을 추가로 설정할 수 있습니다.
          </p>
        </div>
        <input
          type="password"
          required
          autoComplete="new-password"
          aria-label="암호"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="암호 (예: 관련 없는 단어 6개 이상)"
          className="field"
        />
        <PassphraseStrengthMeter
          passphrase={passphrase}
          userInputs={[email, user?.email ?? ""].filter(Boolean)}
        />
        <input
          type="password"
          required
          autoComplete="new-password"
          aria-label="암호 확인"
          value={passphraseConfirm}
          onChange={(e) => setPassphraseConfirm(e.target.value)}
          placeholder="암호 확인"
          className="field"
        />
        {passphraseError && (
          <p role="alert" className="error-text">
            {passphraseError}
          </p>
        )}
        <button type="submit" disabled={deriving} className="btn-primary w-full">
          {deriving ? "키 생성 중..." : "시작하기"}
        </button>
      </form>
    </main>
  );
}
