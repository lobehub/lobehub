import type { VirtualElement } from '@floating-ui/react';
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react';
import type { RefObject } from 'react';
import { useLayoutEffect, useState } from 'react';

const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;

interface MenuPosition {
  visible: boolean;
}

const getSelectionRect = () => {
  const selection = window.getSelection();

  if (!selection?.rangeCount) return new DOMRect();

  return selection.getRangeAt(0).getBoundingClientRect();
};

const hasActiveEditorSelection = () => {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return false;

  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;

  const editor = activeElement.closest('[data-lexical-editor="true"]');
  if (!(editor instanceof HTMLElement)) return false;

  const anchorNode = selection.anchorNode;
  if (!anchorNode) return false;

  const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;

  return !!anchorElement && editor.contains(anchorElement);
};

const createCaretVirtualElement = (): VirtualElement => ({
  getBoundingClientRect: () => getSelectionRect(),
});

export const useMenuPosition = (menuRef: RefObject<HTMLDivElement | null>, open: boolean) => {
  const { refs, update, x, y } = useFloating({
    middleware: [
      offset(MENU_GAP),
      flip({ fallbackPlacements: ['bottom-start'] }),
      shift({ crossAxis: true, mainAxis: false, padding: VIEWPORT_MARGIN }),
    ],
    placement: 'top-start',
    strategy: 'fixed',
  });
  const [position, setPosition] = useState<MenuPosition>({ visible: false });

  useLayoutEffect(() => {
    if (!open || !menuRef.current) {
      setPosition((prev) => ({ ...prev, visible: false }));
      return;
    }

    const menu = menuRef.current;
    const reference = createCaretVirtualElement();
    refs.setFloating(menu);
    refs.setPositionReference(reference);

    const updatePosition = async () => {
      if (!hasActiveEditorSelection()) {
        setPosition({ visible: false });
        return;
      }

      await update();
      setPosition({ visible: true });
    };

    const scheduleUpdate = () => {
      requestAnimationFrame(() => {
        void updatePosition();
      });
    };

    const cleanupAutoUpdate = autoUpdate(reference, menu, scheduleUpdate, {
      animationFrame: true,
    });

    document.addEventListener('focusin', scheduleUpdate);
    document.addEventListener('focusout', scheduleUpdate);
    document.addEventListener('selectionchange', scheduleUpdate);
    scheduleUpdate();

    return () => {
      cleanupAutoUpdate();
      document.removeEventListener('focusin', scheduleUpdate);
      document.removeEventListener('focusout', scheduleUpdate);
      document.removeEventListener('selectionchange', scheduleUpdate);
    };
  }, [menuRef, open, refs, update]);

  return { visible: position.visible, x: x ?? 0, y: y ?? 0 };
};
