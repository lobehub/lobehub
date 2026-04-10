import { memo } from 'react';

import RightPanel from '@/features/RightPanel';
import ConversationArea from '@/routes/(main)/agent/features/Conversation/ConversationArea';

/**
 * Tasks page right-side chat panel.
 *
 * Renders the main conversation (same agentId + activeTopicId as `/agent/:aid`)
 * inside a DraggablePanel, so users can chat with the agent while viewing
 * task list / task detail on the left.
 *
 * Context reuse: ConversationArea internally calls `useAgentContext()` which
 * reads `activeAgentId` / `activeTopicId` from chat store — the same values
 * the main chat page uses. No isolation scope.
 *
 * Tool activation: the parent `_layout` sets `runtimePluginOverrides.forceActivated`
 * on the chat store so `lobe-task` is auto-activated for every LLM step on tasks pages.
 */
const TasksChatPanel = memo(() => {
  return (
    <RightPanel defaultWidth={420} maxWidth={720} minWidth={320}>
      <ConversationArea />
    </RightPanel>
  );
});

TasksChatPanel.displayName = 'TasksChatPanel';

export default TasksChatPanel;
