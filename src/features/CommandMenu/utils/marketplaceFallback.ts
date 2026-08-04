interface MarketplaceFallbackState {
  hasLocalTopicResults: boolean;
  hasResults: boolean;
  isLoading: boolean;
  typeFilter: string | undefined;
}

/**
 * The aggregate search is DB-only, so marketplace hits never appear in its
 * results; the typed-search entries (MCP / plugin / community agent) are the
 * fallback route into marketplace discovery. Only surface them once the
 * aggregate search has settled with no results — they must not crowd out
 * real matches or the loading skeleton.
 */
export const shouldShowMarketplaceFallback = ({
  hasLocalTopicResults,
  hasResults,
  isLoading,
  typeFilter,
}: MarketplaceFallbackState): boolean =>
  !typeFilter && !hasResults && !hasLocalTopicResults && !isLoading;
