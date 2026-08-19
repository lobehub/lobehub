'use client';

import { useMemo } from 'react';

import {
  AcceptanceViewer,
  OriginConversationProvider,
  type OriginConversationSlot,
} from '@/features/Verify';
import TopicPanel from '@/features/Verify/Acceptance/TopicPanel';
import { useTaskStore } from '@/store/task';

export default function AcceptanceRoute() {
  const openTopicDrawer = useTaskStore((s) => s.openTopicDrawer);
  const closeTopicDrawer = useTaskStore((s) => s.closeTopicDrawer);
  const originConversation = useMemo<OriginConversationSlot>(
    () => ({ TopicPanel, closeTopicDrawer, openTopicDrawer }),
    [closeTopicDrawer, openTopicDrawer],
  );

  return (
    <OriginConversationProvider value={originConversation}>
      <AcceptanceViewer />
    </OriginConversationProvider>
  );
}
