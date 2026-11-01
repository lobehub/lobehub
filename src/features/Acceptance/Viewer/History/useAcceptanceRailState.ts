import { useEffect, useState } from 'react';

import { useOriginConversation } from '../Conversation/originConversation';

export const useAcceptanceRailState = ({
  focused,
  isNarrowViewport,
}: {
  focused: boolean;
  isNarrowViewport: boolean;
}) => {
  const originConversation = useOriginConversation();
  const originTopicOpen = Boolean(originConversation?.isOpen);
  const [expand, setExpand] = useState(false);

  useEffect(() => {
    if (isNarrowViewport) setExpand(false);
  }, [isNarrowViewport]);

  useEffect(() => {
    if (focused) setExpand(false);
  }, [focused]);

  useEffect(() => {
    if (originTopicOpen && !focused) setExpand(true);
  }, [focused, originTopicOpen]);

  const onExpandChange = (next: boolean) => {
    setExpand(next);
    // The topic chip must be able to transition from closed to open again.
    if (!next) originConversation?.closeTopicDrawer();
  };

  return { expand, onExpandChange, originConversation };
};
