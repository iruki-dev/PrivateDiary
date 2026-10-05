"use client";

import { useId, useState, type ReactNode } from "react";

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
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
  required?: boolean;
  placeholder?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [visible, setVisible] = useState(false);

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
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-describedby={hint ? hintId : undefined}
          className="field pr-16"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-controls={id}
          aria-label={visible ? `${label} 숨기기` : `${label} 보기`}
          className="absolute inset-y-0 right-0 flex min-w-14 items-center justify-center rounded-r-lg px-3 text-xs font-medium text-zinc-600 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 dark:text-zinc-400"
        >
          {visible ? "숨기기" : "보기"}
        </button>
      </div>
      {hint && (
        <p id={hintId} className="faint mt-1.5 text-xs">
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
