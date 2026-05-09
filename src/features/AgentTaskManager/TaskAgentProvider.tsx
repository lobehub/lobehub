import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { ConversationContext } from '@lobechat/types';
import { isChatGroupSessionId } from '@lobechat/types';
import type { ReactNode } from 'react';
import { createContext, memo, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMatch } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import { ConversationProvider } from '@/features/Conversation';
import { useInitBuiltinAgent } from '@/hooks/useInitBuiltinAgent';
import { useOperationState } from '@/hooks/useOperationState';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

interface TaskAgentProviderProps {
  children: ReactNode;
}

let taskAgentProviderMountCount = 0;
let taskAgentScopeResetScheduled = false;
let taskAgentScopedAgentId: string | undefined;

const TaskAgentSelectionContext = createContext<(agentId: string) => void>(() => {});

export const useTaskAgentSelection = () => use(TaskAgentSelectionContext);

export const TaskAgentProvider = memo<TaskAgentProviderProps>(({ children }) => {
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.inbox);
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.taskAgent);

  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const taskAgentId = useAgentStore(builtinAgentSelectors.taskAgentId);
  const setActiveAgentId = useAgentStore((s) => s.setActiveAgentId);
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const syncedAgentIdRef = useRef<string | undefined>(undefined);
  const [scopedSelectedAgentId, setScopedSelectedAgentId] = useState<string | undefined>(
    () => taskAgentScopedAgentId,
  );

  const detailMatch = useMatch('/task/:taskId');
  const viewedTaskId = detailMatch?.params.taskId;

  const selectedAgentId = scopedSelectedAgentId || taskAgentId;

  const selectTaskAgent = useCallback((agentId: string) => {
    if (!agentId || isChatGroupSessionId(agentId)) return;
    taskAgentScopedAgentId = agentId;
    setScopedSelectedAgentId(agentId);
  }, []);

  useEffect(() => {
    taskAgentProviderMountCount += 1;

    return () => {
      taskAgentProviderMountCount = Math.max(0, taskAgentProviderMountCount - 1);

      // `/tasks` and `/task/:taskId` have separate layouts, so internal task navigation
      // remounts this provider. Delay clearing the retained scope by one microtask so the
      // next task-layout mount can keep the current task topic instead of starting over.
      if (taskAgentScopeResetScheduled) return;
      taskAgentScopeResetScheduled = true;
      queueMicrotask(() => {
        if (taskAgentProviderMountCount === 0) taskAgentScopedAgentId = undefined;
        taskAgentScopeResetScheduled = false;
      });
    };
  }, []);

  useEffect(() => {
    if (!selectedAgentId) return;

    if (useAgentStore.getState().activeAgentId !== selectedAgentId) {
      setActiveAgentId(selectedAgentId);
    }

    const chatState = useChatStore.getState();
    const shouldSyncChatAgent = chatState.activeAgentId !== selectedAgentId;
    const shouldResetTaskTopic = shouldSyncChatAgent || !!chatState.activeTopicId;

    if (shouldSyncChatAgent) {
      useChatStore.setState({ activeAgentId: selectedAgentId });
    }

    if (
      !shouldSyncChatAgent &&
      (syncedAgentIdRef.current === selectedAgentId || taskAgentScopedAgentId === selectedAgentId)
    )
      return;
    syncedAgentIdRef.current = selectedAgentId;
    taskAgentScopedAgentId = selectedAgentId;

    if (shouldResetTaskTopic) {
      void chatState.switchTopic(null, { scope: 'task', skipRefreshMessage: true });
    }
  }, [selectedAgentId, setActiveAgentId]);

  const context = useMemo<ConversationContext>(
    () => ({
      agentId: selectedAgentId || '',
      defaultTaskAssigneeAgentId: inboxAgentId,
      scope: 'task',
      topicId: activeTopicId,
      viewedTask: viewedTaskId ? { taskId: viewedTaskId, type: 'detail' } : { type: 'list' },
    }),
    [activeTopicId, inboxAgentId, selectedAgentId, viewedTaskId],
  );

  const chatKey = useMemo(() => messageMapKey(context), [context]);
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);
  const operationState = useOperationState(context);

  if (!taskAgentId) return <Loading debugId="TaskAgentProvider" />;

  return (
    <TaskAgentSelectionContext value={selectTaskAgent}>
      <ConversationProvider
        context={context}
        hasInitMessages={!!messages}
        messages={messages}
        operationState={operationState}
        onMessagesChange={(msgs, ctx) => {
          replaceMessages(msgs, { context: ctx });
        }}
      >
        {children}
      </ConversationProvider>
    </TaskAgentSelectionContext>
  );
});

TaskAgentProvider.displayName = 'TaskAgentProvider';
