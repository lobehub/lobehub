import type { ChatContextContent } from '@lobechat/types';

export interface SelectionToolbarPosition {
  left: number;
  top: number;
}

export interface TextSelectionContextParams {
  id: string;
  selectedText: string;
  title: string;
}

const TOOLBAR_OFFSET = 12;
const VIEWPORT_MARGIN = 12;
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

export const getSelectionToolbarPosition = (
  rect: DOMRect,
  viewportWidth: number,
): SelectionToolbarPosition => {
  const center = rect.left + rect.width / 2;

  return {
    left: Math.min(Math.max(center, VIEWPORT_MARGIN), viewportWidth - VIEWPORT_MARGIN),
    top: Math.max(rect.top - TOOLBAR_OFFSET, VIEWPORT_MARGIN),
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
