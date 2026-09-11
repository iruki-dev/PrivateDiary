import { describe, expect, it } from "vitest";
import { checkPassphraseStrength } from "../passphraseStrength.js";

/** Phase 8 completion checklist: weak passphrases must be rejected at registration. */
describe("checkPassphraseStrength", () => {
  it("rejects a single dictionary word", () => {
    expect(checkPassphraseStrength("password").isStrongEnough).toBe(false);
    expect(checkPassphraseStrength("dragon").isStrongEnough).toBe(false);
  });

  it("rejects a short common pattern", () => {
    expect(checkPassphraseStrength("qwerty123").isStrongEnough).toBe(false);
  });

  it("rejects a passphrase built from the user's own name (user_inputs)", () => {
    const result = checkPassphraseStrength("alice1990", ["alice"]);
    expect(result.isStrongEnough).toBe(false);
  });

  it("accepts a long, unrelated multi-word passphrase", () => {
    const result = checkPassphraseStrength("correct horse battery staple pond kayak");
    expect(result.isStrongEnough).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(3);
  });
});
