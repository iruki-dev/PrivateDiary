"use client";

import { checkPassphraseStrength } from "@/lib/passphraseStrength";

/**
 * Four ink bars and a sentence. Monochrome on purpose — a red-to-green
 * ramp puts the whole meaning in hue — and the sentence always says what
 * to do next, never just a grade. zxcvbn's own warnings are English, so
 * the advice here is ours, keyed to the score (3 is the minimum the
 * signup and settings forms accept — lib/passphraseStrength.ts).
 */
const VERDICT = ["너무 짧아요.", "약해요.", "조금 더 길게 써 주세요.", "좋아요.", "아주 좋아요."];
const ADVICE = [
  "서로 상관없는 단어 4개 정도를 띄어 써 보세요.",
  "서로 상관없는 단어 4개 정도를 띄어 써 보세요.",
  "단어를 하나 더 붙이면 충분해요.",
  "단어 하나를 더하면 더 안전해요.",
  "이 정도면 충분히 안전해요.",
];

export function PassphraseStrengthMeter({
  passphrase,
  userInputs = [],
}: {
  passphrase: string;
  userInputs?: string[];
}) {
  if (!passphrase) return null;
  const { score } = checkPassphraseStrength(passphrase, userInputs);

  return (
    <div className="space-y-2 pt-1">
      <div className="grid grid-cols-4 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1 rounded-full transition-colors duration-200 ${i <= score ? "bg-ink" : "bg-pill"}`}
          />
        ))}
      </div>
      <p className="text-sm text-ink-2" aria-live="polite">
        <strong className="font-bold text-ink">{VERDICT[score]}</strong> {ADVICE[score]}
      </p>
    </div>
  );
}
