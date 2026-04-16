import { memo } from 'react';

import RightPanel from '@/features/RightPanel';

import Conversation from './Conversation';

/**
 * Tasks page right-side chat panel.
 *
 * Holds its own `activeTopicId` in `useTaskChatStore` so switching a task
 * topic here does not mutate the main chat's `activeTopicId`. Messages are
 * still read from `useChatStore.dbMessagesMap` via a distinct `messageMapKey`
 * derived from the isolated topic id.
 *
 * The parent `_layout` sets `scenarioEnabledToolIds` on the chat store so
 * `lobe-task` is available for every LLM step here.
 */
const AgentTaskManager = memo(() => {
  return (
    <RightPanel defaultWidth={420} maxWidth={720} minWidth={320}>
      <Conversation />
    </RightPanel>
  );
});

AgentTaskManager.displayName = 'AgentTaskManager';

export default AgentTaskManager;
