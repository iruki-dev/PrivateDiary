"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useSeed } from "@/contexts/SeedContext";
import { signInWithGoogle, signUpWithEmail } from "@/lib/firebase/auth";
import { createUserKeyRecord } from "@/lib/firebase/users";
import {
  deriveHybridKeyPair,
  generateMasterSeed,
  generateMnemonic,
  wipeBytes,
  wrapSeed,
  type HybridPublicKeysRaw,
  type WrappedSeed,
} from "@/lib/crypto";
import { checkPassphraseStrength } from "@/lib/passphraseStrength";
import { PassphraseStrengthMeter } from "@/components/PassphraseStrengthMeter";
import { MnemonicReveal } from "@/components/MnemonicReveal";

/**
 * Phase 4 onboarding (ARCHITECTURE.md §3.1 step 1-7): generate the master
 * seed client-side, wrap it with a passphrase that must differ from the
 * login password and meet a minimum strength bar, then show the 24-word
 * mnemonic exactly once before writing the key-issuance document.
 *
 * The login password only ever lives in this component's state, only for
 * as long as it takes to compare it against the chosen passphrase — it's
 * never sent anywhere beyond the one signUpWithEmail() call that created
 * the account (ARCHITECTURE.md rule 5: login credentials and encryption
 * keys are never derived from or mixed with each other, but comparing two
 * independently-chosen values to make sure they're NOT the same is the one
 * place they briefly need to be in the same scope).
 */

type Step = "passphrase" | "mnemonic";

export default function SignupPage() {
  const { user, status: authStatus } = useAuth();
  const { status: seedStatus, refresh } = useSeed();
  const router = useRouter();

  const [step, setStep] = useState<Step>("passphrase");

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

  // --- derived key material, held only in memory for this wizard ---
  const [mnemonic, setMnemonic] = useState("");
  const publicKeysRef = useRef<HybridPublicKeysRaw | null>(null);
  const wrappedSeedRef = useRef<WrappedSeed | null>(null);

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
    } catch {
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
    } catch {
      setAccountError("Google 가입에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setAccountSubmitting(false);
    }
  }

  async function handleSetPassphrase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPassphraseError(null);

    if (passphrase !== passphraseConfirm) {
      setPassphraseError("패스프레이즈 확인이 일치하지 않습니다.");
      return;
    }
    const userInputs = [email, user?.email ?? ""].filter(Boolean);
    if (!checkPassphraseStrength(passphrase, userInputs).isStrongEnough) {
      setPassphraseError("패스프레이즈가 너무 약합니다. 관련 없는 단어 6개 이상을 조합해보세요.");
      return;
    }
    if (loginPasswordRef.current && passphrase === loginPasswordRef.current) {
      setPassphraseError("로그인 비밀번호와 다른 패스프레이즈를 사용해야 합니다.");
      return;
    }

    setDeriving(true);
    try {
      const seed = generateMasterSeed();
      const { publicKeys, privateKeys } = deriveHybridKeyPair(seed);
      const wrapped = await wrapSeed(seed, passphrase);
      const words = generateMnemonic(seed);

      wipeBytes(seed, privateKeys.x25519SecretKey, privateKeys.mlkem768SecretKey);

      publicKeysRef.current = publicKeys;
      wrappedSeedRef.current = wrapped;
      setMnemonic(words);
      setStep("mnemonic");
    } finally {
      loginPasswordRef.current = "";
      setPassphrase("");
      setPassphraseConfirm("");
      setDeriving(false);
    }
  }

  async function handleMnemonicConfirmed() {
    if (!user || !publicKeysRef.current || !wrappedSeedRef.current) return;
    await createUserKeyRecord(user.uid, publicKeysRef.current, wrappedSeedRef.current);
    setMnemonic("");
    await refresh();
    router.replace("/");
  }

  if (authStatus === "loading") {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">확인 중...</p>
      </main>
    );
  }

  if (authStatus === "signed-out") {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <div className="w-full max-w-sm space-y-4">
          <h1 className="text-xl font-semibold">계정 만들기</h1>
          <form onSubmit={handleCreateAccount} className="space-y-4">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <input
              type="password"
              required
              minLength={6}
              value={accountPassword}
              onChange={(e) => setAccountPassword(e.target.value)}
              placeholder="로그인 비밀번호"
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            {accountError && <p className="text-sm text-red-600">{accountError}</p>}
            <button
              type="submit"
              disabled={accountSubmitting}
              className="w-full rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
            >
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
            onClick={handleGoogleSignUp}
            disabled={accountSubmitting}
            className="w-full rounded border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            Google로 계속하기
          </button>
        </div>
      </main>
    );
  }

  if (step === "mnemonic") {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <MnemonicReveal mnemonic={mnemonic} onConfirm={() => void handleMnemonicConfirmed()} />
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <form onSubmit={handleSetPassphrase} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold">일기 암호화 패스프레이즈</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            로그인 비밀번호와는 완전히 다른 값이어야 합니다. 이 패스프레이즈는 서버에 전송되지
            않으며, 잊어버리면 일기 내용을 복구할 방법이 없습니다.
          </p>
        </div>
        <input
          type="password"
          required
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="패스프레이즈 (예: 관련 없는 단어 6개 이상)"
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <PassphraseStrengthMeter
          passphrase={passphrase}
          userInputs={[email, user?.email ?? ""].filter(Boolean)}
        />
        <input
          type="password"
          required
          value={passphraseConfirm}
          onChange={(e) => setPassphraseConfirm(e.target.value)}
          placeholder="패스프레이즈 확인"
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        {passphraseError && <p className="text-sm text-red-600">{passphraseError}</p>}
        <button
          type="submit"
          disabled={deriving}
          className="w-full rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {deriving ? "키 생성 중..." : "다음"}
        </button>
      </form>
    </main>
  );
}
