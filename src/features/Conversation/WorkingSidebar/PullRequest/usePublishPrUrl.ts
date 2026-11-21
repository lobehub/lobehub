import { useEffect } from 'react';

import { useGlobalStore } from '@/store/global';

/**
 * Tell Work cards which PR the sidebar's PR tab can show, so clicking the same
 * PR opens the tab instead of GitHub. Pass `undefined` while the tab could not
 * become visible (no room beside an open portal): the card then keeps its
 * GitHub link. Cleared on unmount, when the tab disappears.
 */
export const usePublishPrUrl = (url: string | undefined) => {
  const setPullRequestUrl = useGlobalStore((s) => s.setWorkingSidebarPullRequestUrl);

  useEffect(() => {
    setPullRequestUrl(url);
    return () => setPullRequestUrl(undefined);
  }, [url, setPullRequestUrl]);
};
