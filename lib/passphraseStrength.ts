import { zxcvbn } from "zxcvbn-ts";

/**
 * Passphrase strength estimation (ARCHITECTURE.md §3.6 rule 3). Deliberately
 * kept out of lib/crypto: this is advisory UX heuristics, not encryption,
 * key derivation, or decryption — lib/crypto's rule 3 boundary is about
 * cryptographic operations specifically.
 *
 * zxcvbn's score is 0-4 ("very unguessable"). 3 (~10^10 guesses, years to
 * crack even offline) is the usual minimum bar recommended for anything
 * protecting long-lived secrets; that's what ARCHITECTURE.md's "오프라인
 * 공격 기준 수십 년 이상" maps to.
 */
export const MIN_PASSPHRASE_SCORE = 3;

export interface PassphraseStrength {
  score: 0 | 1 | 2 | 3 | 4;
  isStrongEnough: boolean;
  warning: string;
  suggestions: readonly string[];
}

export function checkPassphraseStrength(
  passphrase: string,
  userInputs: string[] = []
): PassphraseStrength {
  const result = zxcvbn(passphrase, userInputs);
  return {
    score: result.score,
    isStrongEnough: result.score >= MIN_PASSPHRASE_SCORE,
    warning: result.feedback.warning ?? "",
    suggestions: result.feedback.suggestions ?? [],
  };
}
