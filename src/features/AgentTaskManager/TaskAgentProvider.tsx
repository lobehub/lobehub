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
  const [scopedSelectedAgentId, setScopedSelectedAgentId] = useState<string | undefined>();

  const detailMatch = useMatch('/task/:taskId');
  const viewedTaskId = detailMatch?.params.taskId;

  const selectedAgentId = scopedSelectedAgentId || taskAgentId;

  const selectTaskAgent = useCallback((agentId: string) => {
    if (!agentId || isChatGroupSessionId(agentId)) return;
    setScopedSelectedAgentId(agentId);
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

    if (!shouldSyncChatAgent && syncedAgentIdRef.current === selectedAgentId) return;
    syncedAgentIdRef.current = selectedAgentId;

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
