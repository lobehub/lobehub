import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';

import { commentIdFromHash, useCommentAnchor } from '../Comments/anchor';
import type { EvidenceOverlay } from './overlay';

/** Image pins open manually or through a root/reply link once their comments arrive. */
export const useImageThreads = (annotations: EvidenceOverlay[] = [], embedded = false) => {
  const { hash } = useLocation();
  const addressed = embedded ? undefined : commentIdFromHash(hash);
  const index = addressed
    ? annotations.findIndex(
        (item) => item.threadId === addressed || item.commentIds?.includes(addressed),
      )
    : -1;
  const [openedNote, setOpenedNote] = useState<number>();
  const handled = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (index < 0 || handled.current === addressed) return;
    handled.current = addressed;
    setOpenedNote(index);
  }, [addressed, index]);

  // The panel and its anchors mount in the render after selecting the pin.
  useCommentAnchor(openedNote, embedded || index < 0);

  return {
    openedNote,
    close: () => setOpenedNote(undefined),
    toggleNote: (index: number) =>
      setOpenedNote((current) => (current === index ? undefined : index)),
  };
};
