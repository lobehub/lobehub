export interface SelectionToolbarPosition {
  left: number;
  top: number;
}

const TOOLBAR_OFFSET = 12;
const VIEWPORT_MARGIN = 12;
const LINE_TOP_TOLERANCE = 3;

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

const isVisibleRect = (rect: DOMRect) => rect.width > 0 && rect.height > 0;

/** The topmost visual line among `rects`, merged into one box. */
export const getFirstLineRect = (rects: DOMRect[]): DOMRect | undefined => {
  const visibleRects = rects.filter(isVisibleRect);
  if (visibleRects.length === 0) return;

  const firstTop = Math.min(...visibleRects.map((rect) => rect.top));
  const firstLineRects = visibleRects.filter(
    (rect) => Math.abs(rect.top - firstTop) <= LINE_TOP_TOLERANCE,
  );

  return mergeRects(firstLineRects);
};

export const getRangeFirstLineRect = (range: Range): DOMRect | undefined => {
  const firstLine = getFirstLineRect([...range.getClientRects()]);
  if (firstLine) return firstLine;

  const rect = range.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 ? rect : undefined;
};

/**
 * Boxes of the selected text only.
 *
 * `Range.getClientRects()` also returns the border box of every element lying
 * wholly inside the range. Over positioned layers, such as a PDF page's
 * full-page annotation layer, that box sits far above the selected text, so
 * use these rects to anchor a toolbar to what the user actually selected.
 */
export const getRangeTextRects = (range: Range): DOMRect[] => {
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) return [...range.getClientRects()];

  const rects: DOMRect[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;

    const textRange = document.createRange();
    textRange.selectNodeContents(node);
    if (node === range.startContainer) textRange.setStart(node, range.startOffset);
    if (node === range.endContainer) textRange.setEnd(node, range.endOffset);
    rects.push(...textRange.getClientRects());
  }

  return rects;
};
