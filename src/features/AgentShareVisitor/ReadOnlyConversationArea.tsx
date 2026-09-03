'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import ReadOnlyAgentHome from '@/features/AgentHome/ReadOnly';
import { ChatList, ConversationProvider } from '@/features/Conversation';
import { useOperationState } from '@/hooks/useOperationState';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

interface ReadOnlyConversationAreaProps {
  agentId: string;
  agentShareId: string;
  /** The visitor's currently opened share topic; absent on the new-topic surface. */
  topicId?: string | null;
}

/**
 * Read-only shared-agent message surface.
 *
 * This intentionally does not import the owner's ConversationArea: that surface
 * statically owns the composer, dispatchers, and runtime watchers. Keeping the
 * visitor path separate prevents those owner-scoped side effects (agent
 * switching, tasks, working sidebar, terminal) from mounting on a share page.
 */
const ReadOnlyConversationArea = memo<ReadOnlyConversationAreaProps>(
  ({ agentId, agentShareId, topicId }) => {
    const context = useMemo(
      () => ({ agentId, agentShareId, scope: 'main' as const, topicId: topicId ?? undefined }),
      [agentId, agentShareId, topicId],
    );
    const chatKey = useMemo(() => messageMapKey(context), [context]);
    const replaceMessages = useChatStore((state) => state.replaceMessages);
    const messages = useChatStore((state) => state.dbMessagesMap[chatKey]);
    // Same feed the owner surface uses (`ConversationArea.tsx`). Without it the
    // per-conversation store stays on the all-false default, so the list never
    // sees "generating": the assistant placeholder renders nothing and the
    // streaming fade-in (`useChatMarkdown`'s `animated`) is permanently off,
    // which is what made visitor output look choppy.
    const operationState = useOperationState(context);

    return (
      <ConversationProvider
        context={context}
        hasInitMessages={!!messages}
        messages={messages}
        operationState={operationState}
        onMessagesChange={(nextMessages, nextContext, meta) => {
          replaceMessages(nextMessages, { context: nextContext, source: meta?.source });
        }}
      >
        <Flexbox
          flex={1}
          style={{ overflowX: 'hidden', overflowY: 'auto', position: 'relative' }}
          width={'100%'}
        >
          <ChatList disableActionsBar welcome={<ReadOnlyAgentHome />} />
        </Flexbox>
      </ConversationProvider>
    );
  },
);

ReadOnlyConversationArea.displayName = 'ReadOnlyConversationArea';

export default ReadOnlyConversationArea;
