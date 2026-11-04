/**
 * Literal find over rendered text, painted through the CSS Custom Highlight
 * API: a highlight range owns no DOM, so it survives views that re-render
 * underneath it (virtualized lists, streaming rows, rich-text editors) and is
 * simply rebuilt from what is on screen.
 */

/**
 * Asks whatever clamps a range (a "show more" preview) to open up when the
 * range is cut off. Dispatched by find when it lands on a match; a clamp
 * listens on its own root, so hosts need no wiring. `detail` is the range's
 * on-screen box, so the clamp can tell a clipped match from a visible one.
 */
export const REVEAL_IN_PAGE_EVENT = 'lobe:reveal-in-page';

export type RevealInPageEvent = CustomEvent<{ bottom: number; top: number }>;

export const requestReveal = (range: Range) => {
  const element = range.startContainer.parentElement;
  if (!element || typeof range.getBoundingClientRect !== 'function') return;
  const { bottom, top } = range.getBoundingClientRect();
  element.dispatchEvent(
    new CustomEvent(REVEAL_IN_PAGE_EVENT, { bubbles: true, detail: { bottom, top } }),
  );
};

const SKIPPED_TAGS = new Set(['INPUT', 'NOSCRIPT', 'SCRIPT', 'STYLE', 'TEXTAREA']);

export const supportsHighlightApi = () =>
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

export interface FindKeywordRangesOptions {
  /**
   * Also match text inside `contenteditable` regions. Off by default: a chat
   * composer is not content. Pages whose content *is* an editor (a task's
   * instruction) turn it on.
   */
  includeEditable?: boolean;
}

/** Ranges of every case-insensitive `keyword` occurrence in the text under `root`. */
export const findKeywordRanges = (
  root: Node,
  keyword: string,
  { includeEditable = false }: FindKeywordRangesOptions = {},
): Range[] => {
  const needle = keyword.trim().toLowerCase();
  const document = root.ownerDocument;
  if (!needle || !document) return [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent || SKIPPED_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (!includeEditable && parent.isContentEditable) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const ranges: Range[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? '';
    const text = value.toLowerCase();
    // A case fold that changes the length would shift every offset below.
    if (text.length !== value.length) continue;

    for (let index = text.indexOf(needle); index !== -1;) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      ranges.push(range);
      index = text.indexOf(needle, index + needle.length);
    }
  }

  return ranges;
};

/** Registers `ranges` under `name`, or drops the registry entry when there are none. */
export const setHighlightRanges = (name: string, ranges: Range[], priority: number) => {
  if (!supportsHighlightApi()) return;
  if (ranges.length === 0) {
    CSS.highlights.delete(name);
    return;
  }
  const highlight = new Highlight(...ranges);
  highlight.priority = priority;
  CSS.highlights.set(name, highlight);
};

export const clearHighlights = (names: string[]) => {
  if (!supportsHighlightApi()) return;
  for (const name of names) CSS.highlights.delete(name);
};

const SCROLL_MARGIN = 64;

/**
 * Centers `range` in `container` unless it is already comfortably on screen.
 * Text ranges have no `scrollIntoView`, and scrolling the range's parent
 * element would jump a whole long paragraph to the top instead of the match.
 */
export const scrollRangeIntoView = (range: Range, container: HTMLElement) => {
  // jsdom ranges have no layout.
  if (typeof range.getBoundingClientRect !== 'function') return;
  const rect = range.getBoundingClientRect();
  const box = container.getBoundingClientRect();
  if (rect.height === 0 && rect.width === 0) return;

  if (rect.top >= box.top + SCROLL_MARGIN && rect.bottom <= box.bottom - SCROLL_MARGIN) return;

  container.scrollTo({
    behavior: 'smooth',
    top: container.scrollTop + rect.top - box.top - box.height / 2 + rect.height / 2,
  });
};
