"use client";
import { useEffect } from "react";
// Central trap applies to the topmost dialog, including feature-owned dialogs.
export function useDialogAccessibility() {
  useEffect(() => {
    let cleanup: () => void = () => {};
    let active: HTMLElement | null = null;
    function sync() {
      const dialogs = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="dialog"][aria-modal="true"]',
        ),
      );
      const dialog = dialogs.at(-1) || null;
      if (dialog === active) return;
      cleanup();
      active = dialog;
      if (!dialog) return;
      const restore = document.activeElement as HTMLElement | null;
      const oldOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      dialog.tabIndex = -1;
      const focusable = () =>
        Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
          ),
        ).filter((e) => e.getClientRects().length > 0);
      (focusable()[0] || dialog).focus();
      function key(e: KeyboardEvent) {
        if (e.key === "Escape") {
          e.preventDefault();
          dialog!.querySelector<HTMLButtonElement>(".modal-close")?.click();
        }
        if (e.key === "Tab") {
          const list = focusable();
          if (!list.length) {
            e.preventDefault();
            dialog!.focus();
            return;
          }
          const first = list[0],
            last = list.at(-1)!;
          if (
            e.shiftKey &&
            (document.activeElement === first ||
              !dialog!.contains(document.activeElement))
          ) {
            e.preventDefault();
            last.focus();
          } else if (
            !e.shiftKey &&
            (document.activeElement === last ||
              !dialog!.contains(document.activeElement))
          ) {
            e.preventDefault();
            first.focus();
          }
        }
      }
      document.addEventListener("keydown", key);
      cleanup = () => {
        document.removeEventListener("keydown", key);
        document.body.style.overflow = oldOverflow;
        if (restore?.isConnected) restore.focus();
      };
    }
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => {
      observer.disconnect();
      cleanup();
    };
  }, []);
}
