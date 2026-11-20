import {
  type FocusEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation } from 'react-router';

interface UseAutoClosePopupOptions {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Only a hover card closes on press: a click card opens on that very press. */
  trigger?: 'click' | 'hover';
}

/**
 * Closes a profile hover card whenever its trigger stops being where the card
 * points to. Base UI only closes a hover card on pointer leave, outside press
 * or Escape, and all three need the trigger's listeners to be alive:
 *
 * - Entering an Agent swaps the Home sidebar out and keeps it in a hidden
 *   `<Activity>`. Activity tears down effects but keeps state, and the card's
 *   portal lives outside the hidden layer. Base UI's listeners and its own
 *   close transition both run in effects, so even `open={false}` would leave
 *   the card on screen. `detached` tells the caller to drop the popover
 *   entirely until the trigger is shown again.
 * - A navigation, including one that only changes the query or hash (group
 *   profile tabs, history traversal), can move or replace the trigger without
 *   the pointer ever leaving it.
 * - Scrolling a list moves the trigger away from a pointer that stands still.
 * - Escape: a hover-opened card never takes focus, and an editor that holds it
 *   (the chat composer) stops the key before Base UI's dismiss sees it, so it
 *   is caught in the capture phase and still reaches the editor.
 * - Only one card is open at a time: opening one closes the previous one, and
 *   pressing a trigger (to enter that Agent) closes its card and keeps it shut
 *   until the pointer leaves, so the card never lingers over the next page.
 *
 * Closes that replace the card (another card, a press, a navigation) set
 * `instant`, which the caller turns into a popup without its exit transition,
 * so the old card is gone in the same frame instead of fading out.
 */

interface ActiveCard {
  close: () => void;
}

// The card that is open right now, across every AgentProfilePopup.
let activeCard: ActiveCard | null = null;

export const useAutoClosePopup = ({
  open,
  setOpen,
  trigger = 'hover',
}: UseAutoClosePopupOptions) => {
  // Every navigation gets a new key, query- and hash-only ones included.
  const { key: locationKey } = useLocation();
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;
  const triggerRef = useRef<Element | null>(null);
  const [detached, setDetached] = useState(false);
  const [instant, setInstant] = useState(false);
  // Set by pressing the trigger; blocks hover from reopening the card until the pointer leaves.
  const pressedRef = useRef(false);

  const closeInstantly = useCallback(() => {
    setInstant(true);
    setOpenRef.current(false);
  }, []);

  // Base UI asks to open or close through here.
  const onOpenChange = useCallback((next: boolean) => {
    if (next && pressedRef.current) return;
    if (next) setInstant(false);
    setOpenRef.current(next);
  }, []);

  // Layout effects are cleaned up both when an <Activity> hides the trigger
  // and when it unmounts, and set up again when it is shown.
  useLayoutEffect(() => {
    setDetached(false);
    return () => {
      setOpenRef.current(false);
      setDetached(true);
    };
  }, []);

  const lastLocationKeyRef = useRef(locationKey);
  useEffect(() => {
    if (lastLocationKeyRef.current === locationKey) return;
    lastLocationKeyRef.current = locationKey;
    closeInstantly();
  }, [locationKey, closeInstantly]);

  useEffect(() => {
    if (!open) return;
    const self: ActiveCard = { close: closeInstantly };
    if (activeCard) activeCard.close();
    activeCard = self;
    return () => {
      if (activeCard === self) activeCard = null;
    };
  }, [open, closeInstantly]);

  useEffect(() => {
    if (!open) return;

    const handleScroll = (event: Event) => {
      const trigger = triggerRef.current;
      const target = event.target;
      if (!trigger || !(target instanceof Node)) return;
      // Scrolling inside the card itself must not close it.
      if (target.contains(trigger)) setOpenRef.current(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenRef.current(false);
    };

    document.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      document.removeEventListener('scroll', handleScroll, { capture: true });
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [open]);

  // Passing `ref` to Popover replaces the trigger's own ref handling, so the
  // trigger element is captured from the events that can open the card.
  const triggerProps = useMemo(
    () => ({
      onFocus: (event: FocusEvent<Element>) => {
        triggerRef.current = event.currentTarget;
      },
      onPointerDown: () => {
        if (trigger !== 'hover') return;
        pressedRef.current = true;
        closeInstantly();
      },
      onPointerEnter: (event: PointerEvent<Element>) => {
        triggerRef.current = event.currentTarget;
      },
      onPointerLeave: () => {
        pressedRef.current = false;
      },
    }),
    [closeInstantly, trigger],
  );

  return { detached, instant, onOpenChange, triggerProps };
};
