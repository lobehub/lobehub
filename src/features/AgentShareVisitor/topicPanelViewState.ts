/**
 * The visitor topic list has four mutually-exclusive states, and an SWR fetch
 * only tells the caller two independent booleans (`isLoading`, `error`) plus
 * possibly-stale `data`. Centralizing the branch here keeps `error` and
 * `isLoading` checked *before* falling back to "no topics" — otherwise a
 * pending or failed fetch (where `data` is still `undefined`) renders the same
 * empty state as a genuinely empty list, silently misinforming the visitor.
 */
export type TopicPanelViewState = 'empty' | 'error' | 'list' | 'loading';

export const getTopicPanelViewState = (
  topics: unknown[] | undefined,
  error: unknown,
  isLoading: boolean,
): TopicPanelViewState => {
  if (error) return 'error';
  if (isLoading) return 'loading';
  if (!topics?.length) return 'empty';
  return 'list';
};
