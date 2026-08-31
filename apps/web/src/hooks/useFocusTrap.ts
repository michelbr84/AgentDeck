import { useEffect, useRef, type RefObject } from 'react';

/** What a keyboard user can reach with Tab inside a dialog. */
export const FOCUSABLE_SELECTOR =
  'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * The pure half of the trap: given the dialog's focusable elements in DOM
 * order and the element that currently has focus, return where Tab (or
 * Shift+Tab when `backwards`) should land, wrapping at both ends. Focus that
 * is not in the list (the page behind the dialog, or `body` after a click on
 * the backdrop) is pulled back to the first/last element. Returns null when
 * there is nothing to focus.
 */
export function nextFocusable<T>(elements: readonly T[], current: T | null | undefined, backwards: boolean): T | null {
  if (elements.length === 0) return null;
  const last = elements.length - 1;
  const index = current == null ? -1 : elements.indexOf(current);
  if (index === -1) return elements[backwards ? last : 0] ?? null;
  if (backwards) return elements[index === 0 ? last : index - 1] ?? null;
  return elements[index === last ? 0 : index + 1] ?? null;
}

/**
 * Keeps keyboard focus inside `ref` while `active`: Tab / Shift+Tab cycle
 * through the dialog's focusable elements, Escape is swallowed (the dialog is
 * not dismissible), focus moves into the dialog when it opens and returns to
 * the element that had it once the dialog closes.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  // Where focus came from on the most recent focus change. React applies a
  // child's `autoFocus` in the same commit that mounts the dialog, before any
  // effect here runs, so by then `document.activeElement` is already inside
  // the dialog; the `focusin` that moved it there still knows the origin.
  const focusedFrom = useRef<Element | null>(null);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      focusedFrom.current = e.relatedTarget instanceof Element ? e.relatedTarget : null;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  useEffect(() => {
    if (!active) return;
    const dialog = ref.current;
    if (!dialog) return;

    let restoreTo: Element | null;
    if (dialog.contains(document.activeElement)) {
      restoreTo = focusedFrom.current;
    } else {
      restoreTo = document.activeElement;
      dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // The page behind is unusable until a token is supplied.
        e.preventDefault();
        return;
      }
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const elements = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      nextFocusable(elements, document.activeElement as HTMLElement | null, e.shiftKey)?.focus();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // The opener may have been unmounted meanwhile (pages remount on unlock).
      if (restoreTo instanceof HTMLElement && restoreTo.isConnected) restoreTo.focus();
    };
  }, [ref, active]);
}
