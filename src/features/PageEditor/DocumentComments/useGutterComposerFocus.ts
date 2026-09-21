import type { RefObject } from 'react';
import { useEffect } from 'react';

/** How long the right panel takes to slide in; see `panelSlideMotionVariantsLeft`. */
const PANEL_SETTLE_DELAY = 350;
const RETRY_INTERVAL = 50;

interface GutterComposerFocusParams {
  editorRef: RefObject<{ focus: () => void } | null>;
  /**
   * The pick counter, `0` while the composer has nothing to focus for. Keyed
   * on the counter, not on "has an anchor": the store compares selected
   * values by content, so picking the same run again while the box is still
   * open looks like no change — yet that pick wants the caret back just as
   * the first one did.
   */
  pick: number;
  /**
   * Whether the card can take focus at all. The gutter keeps an unmeasured
   * card `visibility: hidden` until its position is known, and a hidden
   * element silently refuses focus, so trying before this is true is wasted.
   */
  ready: boolean;
  rootRef: RefObject<HTMLElement | null>;
}

/**
 * A caret the reader can type at: the box holds the focus *and* the DOM
 * selection sits inside it. Focus alone is not enough — the body editor's
 * blur clears every DOM range, and a focused box with no range shows no
 * caret and swallows keystrokes.
 */
const hasCaret = (root: HTMLElement) => {
  if (!root.contains(document.activeElement)) return false;
  const anchor = document.getSelection()?.anchorNode ?? null;
  return anchor !== null && root.contains(anchor);
};

/**
 * Put the caret in the gutter composer for a fresh selection.
 *
 * The box shows up while several things are still moving: the body editor is
 * being blurred by the toolbar and refocused by the column's click handler,
 * the panel may still be sliding in, and the card only becomes visible once
 * the gutter has measured where it goes. A single focus call lands in the
 * middle of that, so the attempt waits for the card to be positioned and is
 * then retried until a caret is there or the panel has long since settled.
 */
export const useGutterComposerFocus = ({
  editorRef,
  pick,
  ready,
  rootRef,
}: GutterComposerFocusParams) => {
  useEffect(() => {
    if (!pick || !ready) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      const root = rootRef.current;
      if (!root || hasCaret(root)) return;
      // The DOM focus first, so the editor's own focus finds its root
      // active; the editor's focus then rebuilds the selection at the end
      // of its content, which is what actually paints the caret.
      if (!root.contains(document.activeElement)) {
        root.querySelector<HTMLElement>('[contenteditable="true"]')?.focus({ preventScroll: true });
      }
      editorRef.current?.focus();
      if (hasCaret(root)) return;
      if (Date.now() - started < PANEL_SETTLE_DELAY * 2)
        timer = setTimeout(attempt, RETRY_INTERVAL);
    };
    timer = setTimeout(attempt, 0);
    return () => clearTimeout(timer);
  }, [editorRef, pick, ready, rootRef]);
};
