/** Text the user selected on the PDF text layer, with the pages it spans. */
export interface PDFTextSelection {
  content: string;
  /** 1-based; `endPage` is set only when the selection crosses pages. */
  pageRange: { endPage?: number; startPage: number };
}

/** react-pdf renders each page as this element, carrying its 1-based number. */
const PAGE_SELECTOR = '.react-pdf__Page[data-page-number]';

const getPageNumber = (page: HTMLElement): number | undefined => {
  const value = Number(page.dataset.pageNumber);
  return Number.isInteger(value) && value > 0 ? value : undefined;
};

/**
 * Reads a selection made inside a rendered PDF.
 *
 * Returns nothing when the selection is empty, reaches outside `root`, or
 * touches no page. The pages are the ones the range intersects, so a drag that
 * ends in the gap between two pages still reports both.
 */
export const readPDFTextSelection = (
  selection: Selection | null,
  root: HTMLElement,
): PDFTextSelection | undefined => {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

  const { anchorNode, focusNode } = selection;
  if (!anchorNode || !focusNode || !root.contains(anchorNode) || !root.contains(focusNode)) return;

  const content = selection
    .toString()
    .replaceAll(/[ \t]+\n/g, '\n')
    .trim();
  if (!content) return;

  const range = selection.getRangeAt(0);
  const pages = [...root.querySelectorAll<HTMLElement>(PAGE_SELECTOR)]
    .filter((page) => range.intersectsNode(page))
    .map(getPageNumber)
    .filter((page): page is number => page !== undefined);
  if (pages.length === 0) return;

  const startPage = Math.min(...pages);
  const endPage = Math.max(...pages);

  return { content, pageRange: endPage === startPage ? { startPage } : { endPage, startPage } };
};
