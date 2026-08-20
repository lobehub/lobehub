'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo } from 'react';

import ReadOnlyAgentHome from '@/features/AgentHome/ReadOnly';
import { ChatList, ConversationProvider } from '@/features/Conversation';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

const styles = createStaticStyles(({ css }) => ({
  floatingHeaderSpacer: css`
    height: 0;

    @container agent-chat-layout (min-width: 1200px) {
      height: 44px;
    }
  `,
}));

interface ReadOnlyConversationAreaProps {
  agentId: string;
  agentShareId: string;
}

/**
 * Read-only shared-agent message surface.
 *
 * This intentionally does not import ConversationArea: that owner surface
 * statically owns the composer, dispatchers, and runtime watchers. Keeping the
 * visitor path separate prevents those interactive graphs from entering the
 * standalone Share bundle or mounting owner-scoped side effects.
 */
const ReadOnlyConversationArea = memo<ReadOnlyConversationAreaProps>(
  ({ agentId, agentShareId }) => {
    const context = useMemo(
      () => ({ agentId, agentShareId, scope: 'main' as const }),
      [agentId, agentShareId],
    );
    const chatKey = useMemo(() => messageMapKey(context), [context]);
    const replaceMessages = useChatStore((state) => state.replaceMessages);
    const messages = useChatStore((state) => state.dbMessagesMap[chatKey]);

    return (
      <ConversationProvider
        context={context}
        hasInitMessages={!!messages}
        messages={messages}
        onMessagesChange={(nextMessages, nextContext, meta) => {
          replaceMessages(nextMessages, { context: nextContext, source: meta?.source });
        }}
      >
        <Flexbox
          flex={1}
          style={{ overflowX: 'hidden', overflowY: 'auto', position: 'relative' }}
          width={'100%'}
        >
          <ChatList
            disableActionsBar
            headerSlot={<div aria-hidden className={styles.floatingHeaderSpacer} />}
            welcome={<ReadOnlyAgentHome />}
          />
        </Flexbox>
      </ConversationProvider>
    );
  },
);

ReadOnlyConversationArea.displayName = 'ReadOnlyConversationArea';

export default ReadOnlyConversationArea;
