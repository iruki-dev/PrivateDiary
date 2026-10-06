"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { blockAutofill } from "@/lib/native/autofill";
import { Icon } from "@/components/Icon";

/**
 * Attributes that tell password managers to leave a field alone. The diary
 * passphrase is never stored anywhere — including in a password manager —
 * so its fields must not invite one to save or fill them. There is no
 * standard opt-out for that, so this is every manager's own: autocomplete
 * "off", 1Password, LastPass, Bitwarden, Dashlane and Proton Pass.
 */
const PASSWORD_MANAGER_OPT_OUT = {
  autoComplete: "off",
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
  "data-protonpass-ignore": "true",
} as const;

/**
 * A labelled password input with a show/hide toggle.
 *
 * The toggle matters more here than on a typical login form: the diary
 * passphrase is six-plus words typed on a phone keyboard, and a typo while
 * *setting* it is unrecoverable by design (nothing on the server can reset
 * it). Hidden by default and reset to hidden on every mount, so the shared-
 * screen concern that motivated private writing mode still holds.
 *
 * Autocorrect and auto-capitalisation are off: a phone "fixing" one word of
 * a passphrase silently changes the secret.
 *
 * `autoComplete="passphrase"` marks the diary passphrase, which must never
 * be saved anywhere:
 *  - no password-manager hints (PASSWORD_MANAGER_OPT_OUT above), and in
 *    the Android app, Android's autofill is switched off while the field
 *    is on screen (lib/native/autofill.ts);
 *  - "보기" shows the passphrase to check it, read-only. Typing is always
 *    into a masked field: phone keyboards don't learn from password
 *    fields, but they do learn from visible text, and a learned word list
 *    would be a copy of the passphrase.
 * The login password ("current-password" / "new-password") is an ordinary
 * account password, and a password manager is welcome to it.
 */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  autoFocus,
  required = true,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password" | "passphrase";
  autoFocus?: boolean;
  required?: boolean;
  placeholder?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isPassphrase = autoComplete === "passphrase";

  useEffect(() => (isPassphrase ? blockAutofill() : undefined), [isPassphrase]);

  // Revealed passphrases are read-only; touching the field to type again
  // masks it first, so the keyboard only ever sees a password field.
  function maskForTyping() {
    if (isPassphrase && visible) setVisible(false);
  }

  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          required={required}
          autoFocus={autoFocus}
          ref={inputRef}
          {...(isPassphrase ? PASSWORD_MANAGER_OPT_OUT : { autoComplete })}
          readOnly={isPassphrase && visible}
          onFocus={maskForTyping}
          onPointerDown={maskForTyping}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-describedby={hint ? hintId : undefined}
          className="field pr-14"
        />
        <button
          type="button"
          onClick={() => {
            const next = !visible;
            setVisible(next);
            // Checking a passphrase: drop the keyboard, so nothing is typed
            // while it's visible. Hiding it again: back to typing.
            if (isPassphrase) {
              if (next) inputRef.current?.blur();
              else inputRef.current?.focus();
            }
          }}
          aria-pressed={visible}
          aria-controls={id}
          aria-label={visible ? `${label} 가리기` : `${label} 보기`}
          className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-[0.625rem] text-ink-2 transition-colors hover:text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-ink"
        >
          <Icon name={visible ? "eye-off" : "eye"} size={22} />
        </button>
      </div>
      {isPassphrase && visible && (
        <p className="mt-2 text-[0.8125rem] text-ink-3">확인용으로만 보여요. 칸을 누르면 다시 가려져요.</p>
      )}
      {hint && (
        <p id={hintId} className="mt-2 text-[0.8125rem] leading-relaxed text-ink-3">
          {hint}
        </p>
      )}
    </div>
  );
}

/** A labelled plain input, matching PasswordField's layout. */
export function TextField({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  autoFocus,
  required = true,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email";
  autoComplete?: string;
  autoFocus?: boolean;
  required?: boolean;
  placeholder?: string;
  inputMode?: "text" | "email" | "numeric";
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        inputMode={inputMode}
        autoCapitalize={type === "email" ? "none" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="field"
      />
    </div>
  );
}
