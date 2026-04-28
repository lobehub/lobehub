import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { ConversationContext } from '@lobechat/types';
import { isChatGroupSessionId } from '@lobechat/types';
import type { ReactNode } from 'react';
import { createContext, memo, use, useMemo, useState } from 'react';
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

interface TaskAgentTopicContextValue {
  setTopicId: (topicId: string | null) => void;
  topicId: string | null;
}

const TaskAgentTopicContext = createContext<TaskAgentTopicContextValue | null>(null);

export const useTaskAgentTopic = () => {
  const context = use(TaskAgentTopicContext);

  if (!context) {
    throw new Error('useTaskAgentTopic must be used within TaskAgentProvider');
  }

  return context;
};

export const TaskAgentProvider = memo<TaskAgentProviderProps>(({ children }) => {
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.inbox);
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.taskAgent);

  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const taskAgentId = useAgentStore(builtinAgentSelectors.taskAgentId);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const [topicId, setTopicId] = useState<string | null>(null);

  const detailMatch = useMatch('/task/:taskId');
  const viewedTaskId = detailMatch?.params.taskId;

  const selectedAgentId =
    !activeAgentId || isChatGroupSessionId(activeAgentId) ? taskAgentId : activeAgentId;

  const context = useMemo<ConversationContext>(
    () => ({
      agentId: selectedAgentId || '',
      defaultTaskAssigneeAgentId: inboxAgentId,
      isolatedTopic: true,
      scope: 'task',
      topicId,
      viewedTask: viewedTaskId ? { taskId: viewedTaskId, type: 'detail' } : { type: 'list' },
    }),
    [inboxAgentId, selectedAgentId, topicId, viewedTaskId],
  );

  const chatKey = useMemo(() => messageMapKey(context), [context]);
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);
  const operationState = useOperationState(context);
  const hooks = useMemo(() => ({ onTopicCreated: setTopicId }), []);
  const topicContext = useMemo(() => ({ setTopicId, topicId }), [topicId]);

  if (!taskAgentId) return <Loading debugId="TaskAgentProvider" />;

  return (
    <TaskAgentTopicContext value={topicContext}>
      <ConversationProvider
        context={context}
        hasInitMessages={!!messages}
        hooks={hooks}
        messages={messages}
        operationState={operationState}
        onMessagesChange={(msgs, ctx) => {
          replaceMessages(msgs, { context: ctx });
        }}
      >
        {children}
      </ConversationProvider>
    </TaskAgentTopicContext>
  );
});

TaskAgentProvider.displayName = 'TaskAgentProvider';
