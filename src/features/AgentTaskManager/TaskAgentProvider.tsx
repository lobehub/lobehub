import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { ConversationContext } from '@lobechat/types';
import { isChatGroupSessionId } from '@lobechat/types';
import type { ReactNode } from 'react';
import { createContext, memo, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMatch, useSearchParams } from 'react-router';

import Loading from '@/components/Loading/BrandTextLoading';
import { ConversationProvider } from '@/features/Conversation';
import { useInitBuiltinAgent } from '@/hooks/useInitBuiltinAgent';
import { useOperationState } from '@/hooks/useOperationState';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { resolveTaskHandoffTopic } from './taskHandoff';

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
  const [searchParams] = useSearchParams();
  const routedAgentId = searchParams.get('agentId') || undefined;
  const routedTopicId = searchParams.get('topicId') || undefined;
  const syncedContextRef = useRef<string | undefined>(undefined);
  const [scopedSelectedAgentId, setScopedSelectedAgentId] = useState<string | undefined>(
    routedAgentId,
  );

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
    const targetTopicId = resolveTaskHandoffTopic({
      routedAgentId,
      routedTopicId,
      selectedAgentId,
    });
    const contextKey = `${selectedAgentId}:${targetTopicId ?? ''}`;

    if (shouldSyncChatAgent) {
      useChatStore.setState({ activeAgentId: selectedAgentId });
    }

    if (
      !shouldSyncChatAgent &&
      syncedContextRef.current === contextKey &&
      chatState.activeTopicId === targetTopicId
    )
      return;
    syncedContextRef.current = contextKey;

    // A routed topic must be selected explicitly on a cold load; merely
    // preserving an already-active id leaves the task workspace empty after
    // refresh. Null is the normal list context and does not require a fetch.
    void chatState.switchTopic(targetTopicId, {
      scope: 'task',
      skipRefreshMessage: !targetTopicId,
    });
  }, [routedAgentId, routedTopicId, selectedAgentId, setActiveAgentId]);

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
