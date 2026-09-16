"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = "26rem",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  /*
   * onClose lives in a ref so it is NOT an effect dependency.
   *
   * Every caller passes an inline arrow, so its identity changes on
   * each render. With it in the dependency array the effect tore down
   * and set up again on every keystroke — and because it moves focus
   * into the panel, it pulled focus out of whatever was being typed
   * into. One character would land and the rest went nowhere, which is
   * what "can't type the data continuously" was across every dialog in
   * the app.
   *
   * The handler reads the ref, so it always calls the current onClose
   * without the effect needing to know when it changed.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);

    // Stop the page behind the dialog from scrolling.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  /*
   * Focus moves into the panel ONCE, when the dialog opens — keyboard
   * and screen-reader users need it, but doing it on every render is
   * what broke typing. A field marked autoFocus wins, since that is a
   * deliberate choice by the dialog's author.
   */
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    if (panel.querySelector("[autofocus]")) return;
    panel.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center p-4 bg-black/45 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-full bg-card border border-hairline rounded-2xl shadow-card overflow-hidden animate-in-up focus:outline-none"
        style={{ maxWidth: width }}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-hairline">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="size-8 -mr-1.5 grid place-items-center rounded-full text-muted hover:text-body hover:bg-card-muted transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-5 max-h-[70vh] overflow-y-auto">{children}</div>

        {footer && (
          <div className="px-5 py-4 border-t border-hairline bg-card-muted flex gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
