/**
 * Topic search paints its matches into the conversation through the CSS Custom
 * Highlight API: the message list is virtualized and re-renders while it
 * streams, so wrapping matches in mark nodes would mean owning that DOM. A
 * highlight range owns no DOM and is simply rebuilt from the rendered rows.
 */
import { clearHighlights, setHighlightRanges, supportsHighlightApi } from '@/utils/findInDom';

export { findKeywordRanges, supportsHighlightApi } from '@/utils/findInDom';

export const TOPIC_SEARCH_HIGHLIGHT = {
  active: 'lobe-topic-search-active',
  all: 'lobe-topic-search',
} as const;

export const paintTopicSearchHighlights = (all: Range[], active: Range[]) => {
  if (!supportsHighlightApi()) return;
  setHighlightRanges(TOPIC_SEARCH_HIGHLIGHT.all, all, 1);
  setHighlightRanges(TOPIC_SEARCH_HIGHLIGHT.active, active, 2);
};

export const clearTopicSearchHighlights = () => {
  clearHighlights(Object.values(TOPIC_SEARCH_HIGHLIGHT));
};
