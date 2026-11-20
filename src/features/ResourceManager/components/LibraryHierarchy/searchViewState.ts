import type { HierarchySearchValue } from '@/features/ResourceManager/store/projection';

export interface SearchViewStateInput {
  /** The entry this query owns, if it has one yet. */
  entry?: HierarchySearchValue;
  error?: unknown;
  /** The keyword is typed but its fetch has not been issued yet (debounce gap). */
  isWaitingForDebounce: boolean;
}

export interface SearchViewState {
  /** Content the boundary may keep on screen while a refresh runs or fails. */
  data?: HierarchySearchValue;
  /** The query matched nothing, once the request settled — never while it failed. */
  isEmpty: boolean;
  /** First load, or the debounce gap before it. */
  isLoading: boolean;
}

/**
 * What the sidebar search should show for the query on screen.
 *
 * A persisted head paints before the refresh lands, and a NON-EMPTY one is
 * content worth keeping: a background refresh that fails must not replace the
 * rows on screen with a full-surface error. An EMPTY persisted page is not — it
 * cannot be told apart from "never loaded", so treating it as settled would let
 * a failed reopen report "no results" and hide the retry instead of the error.
 */
export const resolveSearchViewState = ({
  entry,
  error,
  isWaitingForDebounce,
}: SearchViewStateInput): SearchViewState => {
  const hasRows = (entry?.items.length ?? 0) > 0;

  return {
    data: hasRows ? entry : undefined,
    isEmpty: !hasRows && !error,
    isLoading: (!entry && !error) || isWaitingForDebounce,
  };
};
