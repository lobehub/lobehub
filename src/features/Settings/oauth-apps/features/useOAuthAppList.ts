import { oauthAppSelectors, useOAuthAppStore } from '@/store/oauthApp';

/**
 * The app list, shared by the list body and the page header (which hides its
 * Create button while the empty state shows its own). The persisted copy
 * paints on open; the network only confirms.
 */
export const useOAuthAppList = (enabled = true) => {
  const useFetchAppList = useOAuthAppStore((s) => s.useFetchAppList);
  const { error, isValidating, revalidate } = useFetchAppList(enabled);
  const data = useOAuthAppStore(oauthAppSelectors.appList);

  return { data, error, isLoading: !data && !error, isValidating, revalidate };
};
