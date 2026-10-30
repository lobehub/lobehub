import { type RefObject, useEffect, useRef } from 'react';

interface EscapeDiscardGuardOptions {
  /** Read at keypress time, so it can look at refs as well as state. */
  hasUnsavedInput: () => boolean;
  /** Called instead of closing when Escape would discard unsaved input. */
  onEscape: () => void;
}

/**
 * Stops Escape from silently discarding a filled-in modal.
 *
 * The dialog closes on a `document` keydown listener, so stopping the event at
 * the dialog popup keeps it from getting there. Pickers and menus opened from
 * the modal are portalled outside the popup, so Escape still closes just them;
 * an empty modal still closes on Escape as before.
 */
export const useEscapeDiscardGuard = (
  anchorRef: RefObject<HTMLElement | null>,
  options: EscapeDiscardGuardOptions,
) => {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const popup = anchor.closest<HTMLElement>('[role="dialog"]') ?? anchor;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Escape while composing cancels the IME; Safari reports it as keyCode 229.
      if (event.isComposing || event.keyCode === 229) return;
      if (!optionsRef.current.hasUnsavedInput()) return;

      event.preventDefault();
      event.stopPropagation();
      optionsRef.current.onEscape();
    };

    popup.addEventListener('keydown', handleKeyDown);
    return () => popup.removeEventListener('keydown', handleKeyDown);
  }, [anchorRef]);
};
