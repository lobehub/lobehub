import type { ChatContextContent } from '@lobechat/types';

export type SelectionToolbarPlacement = 'bottom' | 'top';

export interface SelectionToolbarViewport {
  /** Bottom edge of the whole selection, used when the toolbar flips below it. */
  selectionBottom: number;
  viewportHeight: number;
  viewportWidth: number;
}

export interface SelectionToolbarPosition {
  left: number;
  placement: SelectionToolbarPlacement;
  top: number;
}

export interface TextSelectionContextParams {
  id: string;
  selectedText: string;
  title: string;
}

const TOOLBAR_OFFSET = 12;
const VIEWPORT_MARGIN = 12;
// Rendered toolbar height (24px small button + 4px padding + 1px border, both sides),
// rounded up so the flip check never lets the toolbar clip the viewport top.
const TOOLBAR_HEIGHT = 36;
const LINE_TOP_TOLERANCE = 3;

export const getSelectionPreview = (selectedText: string): string | undefined => {
  const preview = selectedText.replaceAll(/\s+/g, ' ').trim();
  if (!preview) return;

  return preview.length > 80 ? `${preview.slice(0, 80)}...` : preview;
};

export const createTextSelectionContext = ({
  id,
  selectedText,
  title,
}: TextSelectionContextParams): ChatContextContent => ({
  content: selectedText.trim(),
  format: 'text',
  id,
  preview: getSelectionPreview(selectedText),
  source: 'text',
  title,
  type: 'text',
});

export const isSameTextSelectionContext = (
  item: ChatContextContent,
  selectedText: string,
): boolean =>
  item.source === 'text' &&
  !item.filePath &&
  !item.pageId &&
  item.content.trim() === selectedText.trim();

/**
 * Whether the selected text is already pending in the composer context. Derived from
 * the composer's selections, so it resets once the chip is removed or the message is
 * sent, and holds across repeated selections of the same text.
 */
export const isTextSelectionAdded = (
  selections: ChatContextContent[],
  selectedText: string,
): boolean => selections.some((item) => isSameTextSelectionContext(item, selectedText));

/**
 * Anchors the toolbar above the first selected line so it never covers the
 * selection. Only when there is no room above does it flip below the whole
 * selection, again leaving the selected text visible. A selection taller than
 * the viewport keeps the toolbar clamped on screen.
 */
export const getSelectionToolbarPosition = (
  firstLineRect: DOMRect,
  { selectionBottom, viewportHeight, viewportWidth }: SelectionToolbarViewport,
): SelectionToolbarPosition => {
  const center = firstLineRect.left + firstLineRect.width / 2;
  const left = Math.min(Math.max(center, VIEWPORT_MARGIN), viewportWidth - VIEWPORT_MARGIN);
  const top = firstLineRect.top - TOOLBAR_OFFSET;

  if (top - TOOLBAR_HEIGHT >= VIEWPORT_MARGIN) return { left, placement: 'top', top };

  const maxTop = Math.max(viewportHeight - VIEWPORT_MARGIN - TOOLBAR_HEIGHT, VIEWPORT_MARGIN);

  return {
    left,
    placement: 'bottom',
    top: Math.min(Math.max(selectionBottom + TOOLBAR_OFFSET, VIEWPORT_MARGIN), maxTop),
  };
};

const mergeRects = (rects: DOMRect[]): DOMRect => {
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));

  return DOMRect.fromRect({
    height: bottom - top,
    width: right - left,
    x: left,
    y: top,
  });
};

export const getRangeFirstLineRect = (range: Range): DOMRect | undefined => {
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);

  if (rects.length === 0) {
    const rect = range.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 ? rect : undefined;
  }

  const firstTop = Math.min(...rects.map((rect) => rect.top));
  const firstLineRects = rects.filter(
    (rect) => Math.abs(rect.top - firstTop) <= LINE_TOP_TOLERANCE,
  );

  return mergeRects(firstLineRects);
};
