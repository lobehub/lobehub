'use client';

import { TaskIdentifier } from '@lobechat/builtin-tool-task';
import { Flexbox } from '@lobehub/ui';
import { memo, useEffect } from 'react';
import { Outlet } from 'react-router-dom';

import AgentTaskManager from '@/features/AgentTaskManager';
import { useChatStore } from '@/store/chat';

/**
 * Tasks pages layout.
 *
 * - Horizontal split: task content on the left (list / detail), main-conversation
 *   chat panel on the right. Right panel reuses the same agentId + activeTopicId
 *   as the `/agent/:aid` page via `useAgentContext()` inside ConversationArea.
 *
 * - Enables `lobe-task` for every LLM step while the user is on any tasks
 *   sub-page via the page-level `scenarioEnabledToolIds` chat state.
 */
const TasksLayout = memo(() => {
  useEffect(() => {
    useChatStore.setState({
      scenarioEnabledToolIds: [TaskIdentifier],
    });
    return () => {
      useChatStore.setState({ scenarioEnabledToolIds: undefined });
    };
  }, []);

  return (
    <Flexbox horizontal flex={1} height={'100%'} width={'100%'}>
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <Outlet />
      </Flexbox>
      <AgentTaskManager />
    </Flexbox>
  );
});

TasksLayout.displayName = 'TasksLayout';

export default TasksLayout;
