import { type RefObject, useEffect, useRef } from 'react';

/** Open layers that take Escape before the modal underneath them. */
const OVERLAY_LAYER_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

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
 *
 * Clicking the modal mask drops focus onto `<body>`, where Escape never passes
 * through the popup. That case is caught on `window` before the dialog sees it,
 * unless another layer is open on top of the modal and owns the key.
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

    const handlePageKeyDown = (event: KeyboardEvent) => {
      if (event.target !== document.body && event.target !== document.documentElement) return;
      // Layers are portalled in opening order, so only one mounted after the
      // popup sits above it; a listbox already on the page does not.
      const hasLayerAbove = Array.from(document.querySelectorAll(OVERLAY_LAYER_SELECTOR)).some(
        (layer) =>
          !popup.contains(layer) &&
          Boolean(popup.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING),
      );
      if (hasLayerAbove) return;
      handleKeyDown(event);
    };

    popup.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keydown', handlePageKeyDown, true);
    return () => {
      popup.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keydown', handlePageKeyDown, true);
    };
  }, [anchorRef]);
};
