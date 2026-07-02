import type {
  AgentStreamEvent,
  StreamChunkData,
  StreamStartData,
} from '@lobechat/agent-gateway-client';
import type { ConversationContext, UIChatMessage } from '@lobechat/types';

import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

export interface GatewayMemberStreamHandlerParams {
  /**
   * The shared group conversation context (groupId / topicId / scope='group').
   * Members render in the same `messageMapKey` bucket as the supervisor — the
   * key is derived from groupId, not agentId — so this resolves the member's
   * assistant row to the supervisor's bucket for dispatch.
   */
  context: ConversationContext;
  /**
   * Pull the full canonical group tree into the store ONCE per run (memoized by
   * the caller, shared across all member handlers). This is what makes the
   * members render as a parallel AgentCouncil rather than a stack: the council
   * only forms when the `agentCouncil` tool message AND the member rows are all
   * present so `collectCouncilMembers` can group them. Inserting bare member
   * rows is not enough. Shared + once so concurrent members don't repeatedly
   * `replaceMessages` and clobber each other's in-flight streamed content.
   */
  ensureGroupHydrated: () => Promise<void>;
  /**
   * The member's server-side operationId (the op whose events are forwarded
   * onto the supervisor's WebSocket).
   */
  memberOperationId: string;
  /**
   * The supervisor's LOCAL operation id, so the member's local loading op is
   * recorded as its child for lineage.
   */
  parentOperationId?: string;
}

/**
 * A render-only handler for a broadcast council member whose streaming events
 * are multiplexed onto the supervisor's Gateway WebSocket (server forwards
 * member events onto the supervisor op channel, single-connection
 * multiplexing).
 *
 * Scope is deliberately narrow — it owns ONLY the member's live text/reasoning/
 * tool-call streaming into its council column. It does NOT drive any run
 * lifecycle (the supervisor op owns the K=N barrier, unread, queue drain and
 * notification).
 *
 * Structure availability: during the streaming window the supervisor is parked
 * on the broadcast tool, so the client store has neither the `agentCouncil` tool
 * message nor the member rows — and without the council tool message the members
 * would render as a vertical stack instead of parallel columns. On the first
 * member `stream_start` we therefore hydrate the full canonical group tree once
 * (`ensureGroupHydrated`, shared across members) so the council forms, then
 * stream content into the member row via targeted `updateMessage`. Because we
 * dispatch the full accumulated content (not deltas), any chunk that lands
 * before hydration completes is repainted once the row exists — self-healing.
 */
export const createGatewayMemberStreamHandler = (
  get: () => ChatStore,
  params: GatewayMemberStreamHandlerParams,
): ((event: AgentStreamEvent) => void) => {
  const { context, ensureGroupHydrated, memberOperationId, parentOperationId } = params;

  const bucketKey = messageMapKey({
    agentId: context.agentId ?? '',
    groupId: context.groupId,
    scope: context.scope,
    threadId: context.threadId,
    topicId: context.topicId,
  });

  let localOperationId: string | undefined;
  let currentAssistantMessageId: string | undefined;
  let accumulatedContent = '';
  let accumulatedReasoning = '';
  let ended = false;

  const isMessageInStore = (id: string): boolean =>
    (get().dbMessagesMap[bucketKey] ?? []).some((m) => m.id === id);

  const dispatch = (value: Partial<UIChatMessage>) => {
    if (!currentAssistantMessageId || !localOperationId) return;
    // Self-healing guard: skip until the member row lands in the store (via the
    // shared group hydration). The next chunk repaints the full accumulated
    // content once it's present.
    if (!isMessageInStore(currentAssistantMessageId)) return;
    get().internal_dispatchMessage(
      { id: currentAssistantMessageId, type: 'updateMessage', value },
      { operationId: localOperationId },
    );
  };

  const ensureLocalOp = () => {
    if (localOperationId) return;
    const { operationId } = get().startOperation({
      context,
      metadata: { serverOperationId: memberOperationId },
      parentOperationId,
      type: 'execServerAgentRuntime',
    });
    localOperationId = operationId;
  };

  return (event: AgentStreamEvent) => {
    if (ended) return;

    switch (event.type) {
      case 'stream_start': {
        const data = event.data as StreamStartData | undefined;
        const id = data?.assistantMessage?.id;
        if (!id) break;

        ensureLocalOp();
        currentAssistantMessageId = id;
        if (localOperationId) get().associateMessageWithOperation(id, localOperationId);
        accumulatedContent = '';
        accumulatedReasoning = '';
        // Bring in the council structure (tool message + all member rows) so the
        // members render as parallel columns, then repaint anything already
        // accumulated.
        void ensureGroupHydrated().then(() => {
          if (ended) return;
          if (accumulatedContent) dispatch({ content: accumulatedContent });
          if (accumulatedReasoning) dispatch({ reasoning: { content: accumulatedReasoning } });
        });
        break;
      }

      case 'stream_chunk': {
        const data = event.data as StreamChunkData | undefined;
        if (!data) break;

        if (data.chunkType === 'text' && data.content) {
          accumulatedContent += data.content;
          dispatch({ content: accumulatedContent });
        }
        if (data.chunkType === 'reasoning' && data.reasoning) {
          accumulatedReasoning += data.reasoning;
          dispatch({ reasoning: { content: accumulatedReasoning } });
        }
        if (data.chunkType === 'tools_calling' && data.toolsCalling) {
          dispatch({ tools: data.toolsCalling });
        }
        break;
      }

      case 'visible_output_end': {
        // Example: forwarded member streams can finish text before the
        // supervisor's terminal barrier refetches the group tree. Clear only
        // the member column's visible loading; terminal reconciliation still
        // belongs to agent_runtime_end/error.
        if (localOperationId) {
          get().updateOperationMetadata(localOperationId, { visibleLoadingDone: true });
        }
        break;
      }

      case 'agent_runtime_end':
      case 'error': {
        ended = true;
        // The member row's final structure (tools, content, metadata) is
        // reconciled by the supervisor op's terminal refetch / council barrier.
        // This handler owns only the live text, so just retire the loading op.
        if (localOperationId) get().completeOperation(localOperationId);
        break;
      }
    }
  };
};
