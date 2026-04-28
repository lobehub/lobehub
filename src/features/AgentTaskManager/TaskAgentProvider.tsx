import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { ConversationContext } from '@lobechat/types';
import { isChatGroupSessionId } from '@lobechat/types';
import type { ReactNode } from 'react';
import { memo, useEffect, useMemo, useRef } from 'react';
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

export const TaskAgentProvider = memo<TaskAgentProviderProps>(({ children }) => {
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.inbox);
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.taskAgent);

  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const taskAgentId = useAgentStore(builtinAgentSelectors.taskAgentId);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const setActiveAgentId = useAgentStore((s) => s.setActiveAgentId);
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const syncedAgentIdRef = useRef<string | undefined>(undefined);

  const detailMatch = useMatch('/task/:taskId');
  const viewedTaskId = detailMatch?.params.taskId;

  const selectedAgentId =
    !activeAgentId || isChatGroupSessionId(activeAgentId) ? taskAgentId : activeAgentId;

  useEffect(() => {
    if (!selectedAgentId) return;

    if (useAgentStore.getState().activeAgentId !== selectedAgentId) {
      setActiveAgentId(selectedAgentId);
    }

    const chatState = useChatStore.getState();
    if (chatState.activeAgentId !== selectedAgentId) {
      useChatStore.setState({ activeAgentId: selectedAgentId });
    }

    if (syncedAgentIdRef.current === selectedAgentId) return;
    syncedAgentIdRef.current = selectedAgentId;

    if (chatState.activeTopicId) {
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
  );
});

TaskAgentProvider.displayName = 'TaskAgentProvider';
