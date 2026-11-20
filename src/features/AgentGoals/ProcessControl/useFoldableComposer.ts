import { useCallback, useEffect, useRef, useState } from 'react';

interface FocusableInput {
  focus: () => void;
}

/**
 * Open/folded state for an input that rests behind a trigger. Opening focuses
 * the input; folding from the keyboard hands focus back to the trigger, since
 * the input it was in has just been hidden.
 */
export const useFoldableComposer = (input: FocusableInput | undefined) => {
  const [expanded, setExpanded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef(false);

  // Both targets are only visible after the commit that swaps them, so focus
  // waits for that render instead of moving inside the handler.
  useEffect(() => {
    if (expanded) {
      input?.focus();
      return;
    }
    if (!returnFocusRef.current) return;
    returnFocusRef.current = false;
    triggerRef.current?.focus();
  }, [input, expanded]);

  const open = useCallback(() => setExpanded(true), []);

  /** `returnFocus` when the input still holds focus, e.g. folding on Escape. */
  const fold = useCallback((returnFocus = false) => {
    // Hiding the focused input can blur it, folding a second time; that call
    // must not cancel the hand-back the first one asked for.
    if (returnFocus) returnFocusRef.current = true;
    setExpanded(false);
  }, []);

  return { expanded, fold, open, triggerRef };
};
