"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useSeed } from "@/contexts/SeedContext";
import { checkPassphraseStrength } from "@/lib/passphraseStrength";
import { PassphraseStrengthMeter } from "@/components/PassphraseStrengthMeter";
import { MnemonicReveal } from "@/components/MnemonicReveal";
import { WrongPassphraseError } from "@/lib/crypto";

export default function SettingsPage() {
  const { user, status: authStatus } = useAuth();
  const { status: seedStatus, changePassphrase, resetKeys } = useSeed();
  const router = useRouter();

  useEffect(() => {
    if (authStatus === "signed-in" && seedStatus === "not-issued") {
      router.replace("/signup");
    }
  }, [authStatus, seedStatus, router]);

  if (authStatus !== "signed-in" || seedStatus === "unknown" || seedStatus === "not-issued") {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">확인 중...</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center gap-12 px-6 py-24">
      <ChangePassphraseSection changePassphrase={changePassphrase} />
      <ResetKeysSection userEmail={user?.email ?? ""} resetKeys={resetKeys} />
    </main>
  );
}

function ChangePassphraseSection({
  changePassphrase,
}: {
  changePassphrase: (oldPassphrase: string, newPassphrase: string) => Promise<void>;
}) {
  const [oldPassphrase, setOldPassphrase] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassphrase !== confirmPassphrase) {
      setError("새 패스프레이즈 확인이 일치하지 않습니다.");
      return;
    }
    if (!checkPassphraseStrength(newPassphrase).isStrongEnough) {
      setError("새 패스프레이즈가 너무 약합니다.");
      return;
    }

    setSubmitting(true);
    try {
      await changePassphrase(oldPassphrase, newPassphrase);
      setSuccess(true);
      setOldPassphrase("");
      setNewPassphrase("");
      setConfirmPassphrase("");
    } catch (err) {
      setError(
        err instanceof WrongPassphraseError
          ? "기존 패스프레이즈가 올바르지 않습니다."
          : "패스프레이즈를 변경하지 못했습니다."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="w-full max-w-sm space-y-4">
      <h2 className="text-lg font-semibold">패스프레이즈 변경</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="password"
          required
          value={oldPassphrase}
          onChange={(e) => setOldPassphrase(e.target.value)}
          placeholder="기존 패스프레이즈"
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          type="password"
          required
          value={newPassphrase}
          onChange={(e) => setNewPassphrase(e.target.value)}
          placeholder="새 패스프레이즈"
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <PassphraseStrengthMeter passphrase={newPassphrase} />
        <input
          type="password"
          required
          value={confirmPassphrase}
          onChange={(e) => setConfirmPassphrase(e.target.value)}
          placeholder="새 패스프레이즈 확인"
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">패스프레이즈가 변경되었습니다.</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {submitting ? "변경 중..." : "변경하기"}
        </button>
      </form>
    </section>
  );
}

const RESET_CONFIRM_PHRASE = "초기화합니다";

function ResetKeysSection({
  userEmail,
  resetKeys,
}: {
  userEmail: string;
  resetKeys: (newPassphrase: string) => Promise<string>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mnemonic, setMnemonic] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (confirmPhrase !== RESET_CONFIRM_PHRASE) {
      setError(`확인 문구를 정확히 입력해주세요: "${RESET_CONFIRM_PHRASE}"`);
      return;
    }
    if (newPassphrase !== confirmPassphrase) {
      setError("새 패스프레이즈 확인이 일치하지 않습니다.");
      return;
    }
    if (!checkPassphraseStrength(newPassphrase, [userEmail]).isStrongEnough) {
      setError("새 패스프레이즈가 너무 약합니다.");
      return;
    }

    setSubmitting(true);
    try {
      const words = await resetKeys(newPassphrase);
      setMnemonic(words);
    } catch {
      setError("초기화하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  if (mnemonic) {
    return (
      <section className="w-full max-w-lg">
        <MnemonicReveal
          mnemonic={mnemonic}
          confirmLabel="완료"
          onConfirm={() => {
            setMnemonic("");
            setOpen(false);
          }}
        />
      </section>
    );
  }

  return (
    <section className="w-full max-w-sm space-y-4 rounded border border-red-300 p-4 dark:border-red-900">
      <div>
        <h2 className="text-lg font-semibold text-red-700 dark:text-red-500">초기화</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          기존 패스프레이즈를 모른다면 새 시드를 발급하는 방법뿐입니다. <strong>지금까지 작성한
          모든 일기는 영구히 복호화할 수 없게 됩니다.</strong> 이 작업은 되돌릴 수 없습니다.
        </p>
      </div>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded border border-red-600 px-4 py-2 text-sm font-medium text-red-700 dark:text-red-500"
        >
          초기화 시작
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            계속하려면 아래에 <code className="font-mono">{RESET_CONFIRM_PHRASE}</code>를
            입력하세요.
          </p>
          <input
            type="text"
            required
            value={confirmPhrase}
            onChange={(e) => setConfirmPhrase(e.target.value)}
            placeholder={RESET_CONFIRM_PHRASE}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <input
            type="password"
            required
            value={newPassphrase}
            onChange={(e) => setNewPassphrase(e.target.value)}
            placeholder="새 패스프레이즈"
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <PassphraseStrengthMeter passphrase={newPassphrase} userInputs={[userEmail]} />
          <input
            type="password"
            required
            value={confirmPassphrase}
            onChange={(e) => setConfirmPassphrase(e.target.value)}
            placeholder="새 패스프레이즈 확인"
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "초기화 중..." : "영구적으로 초기화"}
          </button>
        </form>
      )}
    </section>
  );
}
