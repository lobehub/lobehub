'use client';

import { TaskIdentifier } from '@lobechat/builtin-tool-task';
import { Flexbox } from '@lobehub/ui';
import { memo, useEffect } from 'react';
import { Outlet } from 'react-router-dom';

import TasksChatPanel from '@/features/AgentTasks/TasksChatPanel';
import { useChatStore } from '@/store/chat';

/**
 * Tasks pages layout.
 *
 * - Horizontal split: task content on the left (list / detail), main-conversation
 *   chat panel on the right. Right panel reuses the same agentId + activeTopicId
 *   as the `/agent/:aid` page via `useAgentContext()` inside ConversationArea.
 *
 * - Force-activates `lobe-task` for every LLM step while the user is on any tasks
 *   sub-page. Uses `runtimePluginOverrides.forceActivated` which streamingExecutor
 *   merges into `stepContext.activatedToolIds`, so createAgentExecutors bypasses
 *   enableChecker rules via `isExplicitActivation`.
 */
const TasksLayout = memo(() => {
  useEffect(() => {
    useChatStore.setState({
      runtimePluginOverrides: { forceActivated: [TaskIdentifier] },
    });
    return () => {
      useChatStore.setState({ runtimePluginOverrides: undefined });
    };
  }, []);

  return (
    <Flexbox horizontal flex={1} height={'100%'} width={'100%'}>
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <Outlet />
      </Flexbox>
      <TasksChatPanel />
    </Flexbox>
  );
});

TasksLayout.displayName = 'TasksLayout';

export default TasksLayout;
