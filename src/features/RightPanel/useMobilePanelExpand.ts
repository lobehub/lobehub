import { useEffect } from 'react';

/**
 * A side panel's open state is a persisted desktop preference. On a phone the
 * panel covers the whole page, so it starts closed there and opens only on an
 * explicit toggle or selection made on this page.
 */
export const useMobilePanelExpand = (
  mobile: boolean,
  expand: boolean,
  onExpandChange: (expand: boolean) => void,
) => {
  useEffect(() => {
    if (mobile && expand) onExpandChange(false);
    // Mount only: later `expand` changes are the user's own toggles.
  }, []);
};
