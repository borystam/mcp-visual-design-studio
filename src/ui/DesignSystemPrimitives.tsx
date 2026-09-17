import React, { useEffect, useRef, useState } from "react";

export function SystemButton({
  children,
  primary,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`button ${primary ? "primary" : ""} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}
export function SystemField({
  label,
  value,
  onCommit,
  multiline = false,
  ...props
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false),
    dirty = useRef(false);
  useEffect(() => {
    if (!focused.current || !dirty.current) setText(value);
  }, [value]);
  const attributes = {
    ...props,
    "aria-label": label,
    value: text,
    onFocus: () => {
      focused.current = true;
    },
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      dirty.current = true;
      setText(event.target.value);
    },
    onBlur: () => {
      focused.current = false;
      if (dirty.current) onCommit(text);
      dirty.current = false;
    },
  };
  return (
    <label className="field ds-field">
      <span>{label}</span>
      {multiline ? (
        <textarea {...attributes} />
      ) : (
        <input
          {...attributes}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      )}
    </label>
  );
}
export function SystemMessage({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`ds-message ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function useSystemDialog(
  open: boolean,
  ref: React.RefObject<HTMLElement | null>,
  close: () => void,
) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ) ?? [],
      ).filter(
        (element) =>
          !element.closest("[inert]") && element.getClientRects().length > 0,
      );
    if (!panel?.contains(document.activeElement)) focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const all = focusable(),
          first = all[0],
          last = all.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [open, ref]);
}
