import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { ConversationContext } from '@lobechat/types';
import { isChatGroupSessionId } from '@lobechat/types';
import type { ReactNode } from 'react';
import { memo, useMemo } from 'react';
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
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.taskAgent);

  const taskAgentId = useAgentStore(builtinAgentSelectors.taskAgentId);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const activeTopicId = useChatStore((s) => s.activeTopicId);

  const detailMatch = useMatch('/task/:taskId');
  const viewedTaskId = detailMatch?.params.taskId;

  const selectedAgentId =
    !activeAgentId || isChatGroupSessionId(activeAgentId) ? taskAgentId : activeAgentId;

  const context = useMemo<ConversationContext>(
    () => ({
      agentId: selectedAgentId || '',
      scope: 'task',
      topicId: activeTopicId,
      viewedTask: viewedTaskId ? { taskId: viewedTaskId, type: 'detail' } : { type: 'list' },
    }),
    [activeTopicId, selectedAgentId, viewedTaskId],
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
