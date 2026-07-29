import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { isChatGroupSessionId } from '@lobechat/types';
import type { ReactNode } from 'react';
import { memo, useEffect, useMemo, useRef } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import type { ConversationContext } from '@/features/Conversation';
import { ConversationProvider } from '@/features/Conversation';
import { useOperationState } from '@/hooks/useOperationState';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

interface PageAgentProviderProps {
  children: ReactNode;
  /**
   * The id of the document currently open in the editor. Injected into the
   * conversation context as `documentId` so page-scoped tool calls are bound to
   * this exact document instead of relying on the process-wide
   * `pageAgentRuntime` singleton, which can only represent one open document and
   * gets cleared/overwritten when switching tabs.
   */
  pageId?: string;
  /**
   * Keep legacy page-editor behavior: sync the selected page copilot agent into
   * the global agent/chat stores. Disable when PageEditor is embedded inside an
   * existing agent layout that must keep its own active agent and working panel.
   */
  syncActiveAgent?: boolean;
}

export const PageAgentProvider = memo<PageAgentProviderProps>(
  ({ children, pageId, syncActiveAgent = true }) => {
    const useInitBuiltinAgent = useAgentStore((s) => s.useInitBuiltinAgent);
    const pageAgentId = useAgentStore(builtinAgentSelectors.pageAgentId);
    const activeTopicId = useChatStore((s) => s.activeTopicId);
    const activeAgentId = useAgentStore((s) => s.activeAgentId);
    const isActiveAgentHeterogeneous = useAgentStore((s) =>
      activeAgentId ? agentByIdSelectors.isAgentHeterogeneousById(activeAgentId)(s) : false,
    );
    const setActiveAgentId = useAgentStore((s) => s.setActiveAgentId);
    const syncedAgentIdRef = useRef<string | undefined>(undefined);

    useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.pageAgent);

    // Build conversation context for page agent.
    // Fall back to the page agent when the global active agent cannot drive a page
    // copilot: empty, a chat-group id, or a heterogeneous agent (e.g. Claude Code
    // / Codex). Heterogeneous agents run on external runtimes and must not leak
    // into the page-scoped conversation when navigating from their tab.
    const selectedAgentId =
      !activeAgentId || isChatGroupSessionId(activeAgentId) || isActiveAgentHeterogeneous
        ? pageAgentId
        : activeAgentId;

    useEffect(() => {
      if (!selectedAgentId || !syncActiveAgent) return;

      if (useAgentStore.getState().activeAgentId !== selectedAgentId) {
        setActiveAgentId(selectedAgentId);
      }

      const chatState = useChatStore.getState();
      const shouldResetTopic =
        chatState.activeAgentId !== selectedAgentId || !!chatState.activeTopicId;

      if (chatState.activeAgentId !== selectedAgentId) {
        useChatStore.setState(
          { activeAgentId: selectedAgentId },
          false,
          'PageEditor/PageAgentProvider/syncActiveAgentId',
        );
      }

      if (syncedAgentIdRef.current === selectedAgentId) return;
      syncedAgentIdRef.current = selectedAgentId;

      if (shouldResetTopic) {
        void chatState.switchTopic(null, { scope: 'page', skipRefreshMessage: true });
      }
    }, [selectedAgentId, setActiveAgentId, syncActiveAgent]);

    const context = useMemo<ConversationContext>(
      () => ({
        agentId: selectedAgentId,
        // Bind the conversation to the open document directly so page-scoped tool
        // calls don't depend on the `pageAgentRuntime` singleton, which can't
        // represent multiple tabs/documents and is cleared on tab switch.
        documentId: pageId,
        scope: 'page',
        topicId: syncActiveAgent ? activeTopicId : null,
      }),
      [selectedAgentId, activeTopicId, pageId, syncActiveAgent],
    );

    // Get messages from ChatStore based on context
    const chatKey = useMemo(() => messageMapKey(context), [context]);
    const replaceMessages = useChatStore((s) => s.replaceMessages);
    const messages = useChatStore((s) => (chatKey ? s.dbMessagesMap[chatKey] : undefined));

    // Get operation state for reactive updates
    const operationState = useOperationState(context);

    if (!pageAgentId) return <Loading debugId="PageAgentProvider" />;

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
  },
);
