import { type Dispatch, type SetStateAction, useEffect, useRef } from 'react';

import { type ChannelTab, isRecordTab } from './channelTabs';

/**
 * The chat preview shows how the settings behave; the wake records are a wide table with nothing
 * to preview. Opening the records tab folds the preview away, and leaving it puts the preview back
 * the way it was. Opening the preview by hand on the records tab is kept until the tab is left.
 */
export const useFoldPreviewOnRecords = (
  activeTab: ChannelTab,
  previewOpen: boolean,
  setPreviewOpen: Dispatch<SetStateAction<boolean>>,
) => {
  const openRef = useRef(previewOpen);
  openRef.current = previewOpen;
  // What the preview was before the records tab folded it; unset while not folded by it.
  const restoreRef = useRef<boolean>(undefined);
  const onRecords = isRecordTab(activeTab);

  useEffect(() => {
    if (onRecords) {
      restoreRef.current = openRef.current;
      setPreviewOpen(false);
    } else if (restoreRef.current !== undefined) {
      setPreviewOpen(restoreRef.current);
      restoreRef.current = undefined;
    }
  }, [onRecords, setPreviewOpen]);
};
