import type { ShareVisitorTopicGroup } from '@lobechat/types';
import { useMemo } from 'react';

import { useActiveLocation } from '@/hooks/useActiveLocation';

const VISITOR_TOPIC_PATH = /\/visitor\/([^/]+)\/?$/;

/**
 * The visitor topic open beside the sidebar, and the visitor it belongs to.
 *
 * Reads the active tab's URL, not the router the sidebar renders in: on desktop the sidebar sits
 * outside the tab's router, where `useLocation` never sees `/visitor/:topicId` and no row would
 * show as selected.
 */
export const useActiveVisitorTopic = (groups: ShareVisitorTopicGroup[]) => {
  const { pathname } = useActiveLocation();
  const activeTopicId = VISITOR_TOPIC_PATH.exec(pathname)?.[1];
  const activeVisitorId = useMemo(
    () =>
      activeTopicId
        ? groups.find((group) => group.topics.some((topic) => topic.id === activeTopicId))?.visitor
            .id
        : undefined,
    [activeTopicId, groups],
  );

  return { activeTopicId, activeVisitorId };
};
