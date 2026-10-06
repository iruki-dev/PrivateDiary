import { describe, expect, it } from "vitest";
import { autofillAllowed, blockAutofill, isAutofillBlocked, subscribeAutofillBlocks } from "../autofill";

describe("autofill blocks for passphrase fields", () => {
  it("is blocked while any passphrase field holds a block", () => {
    let changes = 0;
    const off = subscribeAutofillBlocks(() => changes++);
    const a = blockAutofill();
    const b = blockAutofill();
    expect(isAutofillBlocked()).toBe(true);
    a();
    a(); // releasing twice must not unblock the other field
    expect(isAutofillBlocked()).toBe(true);
    b();
    expect(isAutofillBlocked()).toBe(false);
    off();
    expect(changes).toBe(4);
  });

  it("allows autofill only for the login password, never beside a passphrase", () => {
    expect(autofillAllowed("/login", false)).toBe(true);
    expect(autofillAllowed("/signup", false)).toBe(true);
    // Signup's second step asks for the passphrase on the same route.
    expect(autofillAllowed("/signup", true)).toBe(false);
    expect(autofillAllowed("/entries", false)).toBe(false);
    expect(autofillAllowed("/settings", false)).toBe(false);
  });
});
