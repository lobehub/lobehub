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

      if (event.key === 'Escape' && onEscape) {
        event.preventDefault();
        onEscape();
      } else if (event.key === 'Enter' && onEnter && !event.shiftKey) {
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
