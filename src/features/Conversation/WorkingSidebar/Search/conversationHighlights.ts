/**
 * Topic search paints its matches into the conversation through the CSS Custom
 * Highlight API: the message list is virtualized and re-renders while it
 * streams, so wrapping matches in mark nodes would mean owning that DOM. A
 * highlight range owns no DOM and is simply rebuilt from the rendered rows.
 */
export const TOPIC_SEARCH_HIGHLIGHT = {
  active: 'lobe-topic-search-active',
  all: 'lobe-topic-search',
} as const;

const SKIPPED_TAGS = new Set(['INPUT', 'NOSCRIPT', 'SCRIPT', 'STYLE', 'TEXTAREA']);

export const supportsHighlightApi = () =>
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

/** Ranges of every case-insensitive `keyword` occurrence in the text under `root`. */
export const findKeywordRanges = (root: Node, keyword: string): Range[] => {
  const needle = keyword.trim().toLowerCase();
  const document = root.ownerDocument;
  if (!needle || !document) return [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      return !parent || SKIPPED_TAGS.has(parent.tagName) || parent.isContentEditable
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
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

const setRegistry = (name: string, ranges: Range[], priority: number) => {
  if (ranges.length === 0) {
    CSS.highlights.delete(name);
    return;
  }
  const highlight = new Highlight(...ranges);
  highlight.priority = priority;
  CSS.highlights.set(name, highlight);
};

export const paintTopicSearchHighlights = (all: Range[], active: Range[]) => {
  if (!supportsHighlightApi()) return;
  setRegistry(TOPIC_SEARCH_HIGHLIGHT.all, all, 1);
  setRegistry(TOPIC_SEARCH_HIGHLIGHT.active, active, 2);
};

export const clearTopicSearchHighlights = () => {
  if (!supportsHighlightApi()) return;
  for (const name of Object.values(TOPIC_SEARCH_HIGHLIGHT)) CSS.highlights.delete(name);
};
