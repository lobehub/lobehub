import { useEffect } from 'react';

interface MobilePanelExpandParams {
  expand: boolean;
  /** `expand` mirrors a selection made on this page rather than a saved preference. */
  expandFollowsSelection?: boolean;
  mobile: boolean;
  onExpandChange: (expand: boolean) => void;
}

/**
 * A side panel's open state is usually a persisted desktop preference. On a
 * phone the panel covers the whole page, so it starts closed there and opens
 * only on an explicit toggle or selection made on this page. A panel whose open
 * state is that selection stays as it mounted.
 */
export const useMobilePanelExpand = ({
  expand,
  expandFollowsSelection,
  mobile,
  onExpandChange,
}: MobilePanelExpandParams) => {
  useEffect(() => {
    if (mobile && !expandFollowsSelection && expand) onExpandChange(false);
    // Mount only: later `expand` changes are the user's own toggles.
  }, []);
};
