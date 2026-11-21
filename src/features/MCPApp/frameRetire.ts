/**
 * Keep a removed MCP App view running long enough to finish. MCP Apps asks the
 * host to send `ui/resource-teardown` before it removes a view and to wait for
 * the answer (the view may save pending edits), but React drops the iframe's
 * browsing context as soon as it unmounts it, and an ordinary DOM move reloads
 * an iframe. `moveBefore` moves it without reloading, so the frame waits in an
 * off-screen holder while its view finishes.
 */

type MovableParent = HTMLElement & { moveBefore: (node: Node, child: Node | null) => void };

const canMove = (element: HTMLElement): element is MovableParent =>
  typeof (element as Partial<MovableParent>).moveBefore === 'function';

let holder: HTMLElement | undefined;

const getHolder = (): HTMLElement => {
  if (holder?.isConnected) return holder;

  holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.dataset.mcpAppRetired = '';
  Object.assign(holder.style, {
    height: '1px',
    left: '-10000px',
    overflow: 'hidden',
    pointerEvents: 'none',
    position: 'fixed',
    top: '0',
    width: '1px',
  });
  document.body.append(holder);

  return holder;
};

/**
 * Call from a layout-effect cleanup, while `frame` is still in the document.
 * Moves the frame aside, then, once the commit is done:
 * - its slot is gone (the view really unmounted): `teardown`, then removes it;
 * - its slot is still there (StrictMode re-ran the effect): moves it back and
 *   calls `keep`.
 * Returns false, leaving the frame alone, where it can't be moved intact; the
 * caller then ends the session as before.
 */
export const retireAppFrame = (
  frame: HTMLIFrameElement,
  { keep, teardown }: { keep: () => void; teardown: () => Promise<void> },
): boolean => {
  const slot = frame.parentElement;
  if (!slot || !frame.isConnected || !canMove(slot)) return false;

  const aside = getHolder();
  if (!canMove(aside)) return false;
  aside.moveBefore(frame, null);

  queueMicrotask(() => {
    if (slot.isConnected) {
      slot.moveBefore(frame, null);
      keep();
      return;
    }
    void teardown().finally(() => frame.remove());
  });

  return true;
};
