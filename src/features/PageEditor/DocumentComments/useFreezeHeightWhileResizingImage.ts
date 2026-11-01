import { useCallback, useEffect, useState } from 'react';

/**
 * The image plugin's resize handle: a childless `div` with `cursor: col-resize`
 * rendered next to the `<img>` inside the editable area. It carries no stable
 * class or data attribute, so recognise it by what it is rather than by name.
 */
const isImageResizeHandle = (target: EventTarget | null): target is HTMLElement => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.childElementCount > 0) return false;
  if (!target.closest('[contenteditable="true"]')) return false;
  if (!target.parentElement?.querySelector('img')) return false;
  return getComputedStyle(target).cursor === 'col-resize';
};

/**
 * Comment boxes grow with their content, and image resizing is aspect-locked,
 * so every horizontal drag frame also changes the box height — the border
 * visibly pulses while the handle moves. Freeze the wrapper at its current
 * height for the duration of the drag (clipping any growth) and let it settle
 * to the final size once the mouse is released.
 */
export const useFreezeHeightWhileResizingImage = () => {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const rootRef = useCallback((node: HTMLDivElement | null) => setRoot(node), []);

  useEffect(() => {
    if (!root) return;

    let release: (() => void) | undefined;

    const onMouseDown = (event: MouseEvent) => {
      if (!isImageResizeHandle(event.target)) return;

      root.style.height = `${root.getBoundingClientRect().height}px`;
      root.style.overflow = 'hidden';

      release = () => {
        root.style.height = '';
        root.style.overflow = '';
        release = undefined;
      };
      document.addEventListener('mouseup', release, { once: true });
    };

    // Capture phase: the handle stops propagation of its own mousedown.
    root.addEventListener('mousedown', onMouseDown, true);
    return () => {
      root.removeEventListener('mousedown', onMouseDown, true);
      if (release) {
        document.removeEventListener('mouseup', release);
        release();
      }
    };
  }, [root]);

  return rootRef;
};
