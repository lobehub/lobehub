import { useEffect, useRef } from 'react';

interface ToolKeyHandlers {
  onEnter?: () => void;
  onEscape?: () => void;
  onUndo?: () => void;
}

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Shortcuts belong to the viewer: a key pressed on another part of the page
 * (the chat next to a portal preview) is not for the tool. With nothing
 * focused the event targets the body, which still counts.
 */
const isOutsideViewer = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  target !== document.body &&
  !target.closest('[data-testid="image-viewer"]');

/** Enter on a focused control activates that control, not the tool's primary action. */
const isControlTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest('button, a[href], [role="button"], [role="menuitem"], [role="option"]');

/**
 * Keyboard shortcuts for an active tool mode: Esc cancels, Enter completes,
 * ⌘/Ctrl+Z undoes. Ignored while the user is typing into a field, except Esc
 * from a single-line input.
 */
export const useToolKeys = (handlers: ToolKeyHandlers) => {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const { onEnter, onEscape, onUndo } = ref.current;
      // Esc still cancels from a single-line field (the size inputs); multi-line
      // editors such as the comment draft handle Esc themselves.
      const escapeFromInput = event.key === 'Escape' && event.target instanceof HTMLInputElement;
      if (isTypingTarget(event.target) && !escapeFromInput) return;
      if (isOutsideViewer(event.target)) return;

      if (event.key === 'Escape' && onEscape) {
        event.preventDefault();
        onEscape();
      } else if (
        event.key === 'Enter' &&
        onEnter &&
        !event.shiftKey &&
        !isControlTarget(event.target)
      ) {
        event.preventDefault();
        onEnter();
      } else if (event.key.toLowerCase() === 'z' && (event.metaKey || event.ctrlKey) && onUndo) {
        event.preventDefault();
        onUndo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
};
