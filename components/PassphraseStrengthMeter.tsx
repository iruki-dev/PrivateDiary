"use client";

import { checkPassphraseStrength } from "@/lib/passphraseStrength";

const LABELS = ["매우 약함", "약함", "보통", "강함", "매우 강함"];
const COLORS = ["bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-lime-500", "bg-green-500"];

export function PassphraseStrengthMeter({
  passphrase,
  userInputs = [],
}: {
  passphrase: string;
  userInputs?: string[];
}) {
  if (!passphrase) return null;
  const { score, warning } = checkPassphraseStrength(passphrase, userInputs);

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded ${i <= score ? COLORS[score] : "bg-zinc-200 dark:bg-zinc-700"}`}
          />
        ))}
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        강도: {LABELS[score]}
        {warning ? ` — ${warning}` : ""}
      </p>
    </div>
  );
}
