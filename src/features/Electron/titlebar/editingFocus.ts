const EDITING_MENU_ROLES = new Set([
  'copy',
  'cut',
  'delete',
  'paste',
  'pasteAndMatchStyle',
  'redo',
  'selectAll',
  'undo',
]);

export const isEditingMenuRole = (role?: string): boolean =>
  role !== undefined && EDITING_MENU_ROLES.has(role);

export interface EditingTarget {
  element: HTMLElement;
  range: Range | null;
  selectionEnd: number | null;
  selectionStart: number | null;
}

const isTextControl = (element: HTMLElement): element is HTMLInputElement | HTMLTextAreaElement =>
  element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;

const isEditableElement = (element: Element | null): element is HTMLElement => {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;

  return isTextControl(element);
};

export const captureEditingTarget = (
  active: Element | null = document.activeElement,
): EditingTarget | null => {
  if (!isEditableElement(active)) return null;

  let range: Range | null = null;
  if (active.isContentEditable) {
    const selection = active.ownerDocument.getSelection();
    if (selection && selection.rangeCount > 0 && active.contains(selection.anchorNode)) {
      range = selection.getRangeAt(0).cloneRange();
    }
  }

  return {
    element: active,
    range,
    selectionEnd: isTextControl(active) ? active.selectionEnd : null,
    selectionStart: isTextControl(active) ? active.selectionStart : null,
  };
};

export const restoreEditingTarget = (target: EditingTarget | null): boolean => {
  if (!target?.element.isConnected) return false;

  target.element.focus();

  if (
    isTextControl(target.element) &&
    target.selectionStart !== null &&
    target.selectionEnd !== null
  ) {
    target.element.setSelectionRange(target.selectionStart, target.selectionEnd);
  }

  if (target.range) {
    const selection = target.element.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(target.range);
  }

  return true;
};

/**
 * Menu close returns focus in a microtask after paint. Wait two frames so an
 * edit role runs against the restored editor, not the menu row that stole focus.
 */
export const runWhenMenuFocusSettles = (
  action: () => void,
  scheduleFrame: (frame: () => void) => void = requestAnimationFrame,
): void => {
  scheduleFrame(() => {
    scheduleFrame(action);
  });
};
