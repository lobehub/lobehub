import type {
  AgentSignalSourceEvent,
  SourceEventAgentUserMessage,
} from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import { MessageModel } from '@/database/models/message';
import type { LobeChatDatabase } from '@/database/type';

/** Reason a `client.runtime.complete` event could not become a feedback source. */
export type ClientRuntimeCompleteHydrationSkipReason =
  | 'assistant-message-not-found'
  | 'empty-content'
  | 'missing-assistant-message-id'
  | 'missing-parent-message-id'
  | 'non-completed-status'
  | 'non-assistant-message'
  | 'non-user-parent'
  | 'parent-message-not-found';

/** Diagnostic emitted while hydrating a client runtime-complete source. */
export interface ClientRuntimeCompleteHydrationDiagnostic {
  /** Lifecycle source type that produced this hydration diagnostic. */
  kind: typeof AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete;
  /** Stable skip reason for tracing when `status` is `skipped`. */
  reason?: ClientRuntimeCompleteHydrationSkipReason;
  /** Whether hydration produced a trusted server source. */
  status: 'resolved' | 'skipped';
}

/** Result of client runtime-complete source hydration. */
export interface ClientRuntimeCompleteHydrationResult {
  /** Trusted assistant message id that should bound later context assembly. */
  contextBoundaryMessageId?: string;
  /** Trusted assistant row timestamp that can cap later context assembly. */
  contextEndAt?: Date;
  /** Trace-safe hydration status and optional skip reason. */
  diagnostic: ClientRuntimeCompleteHydrationDiagnostic;
  /** Hydrated feedback source, present only when `diagnostic.status` is `resolved`. */
  source?: SourceEventAgentUserMessage;
}

const skipped = (
  reason: ClientRuntimeCompleteHydrationSkipReason,
): ClientRuntimeCompleteHydrationResult => ({
  diagnostic: {
    kind: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
    reason,
    status: 'skipped',
  },
});

const getHydratedSourceId = (assistantMessageId: string, parentMessageId: string) =>
  `${assistantMessageId}:completion:${parentMessageId}`;

const getTrustedScopeKey = (
  trustedTopicId: string | null | undefined,
  fallbackScopeKey: string,
) => {
  return trustedTopicId ? `topic:${trustedTopicId}` : fallbackScopeKey;
};

/**
 * Resolves a client runtime-complete event into a trusted feedback source.
 *
 * Use when:
 * - The browser emitted only `client.runtime.complete`.
 * - Feedback policies need server-owned final-turn user message content.
 *
 * Expects:
 * - `db` and `userId` point at the current user's message store.
 * - `source.payload.assistantMessageId` points to the completed assistant row.
 *
 * Returns:
 * - A hydrated `agent.user.message` source with the parent user message content.
 * - The trusted assistant row boundary for downstream context assembly.
 * - A skipped diagnostic when the client event cannot safely become feedback.
 */
export const resolveClientRuntimeCompleteFeedbackSource = async (
  sourceEvent: AgentSignalSourceEvent<typeof AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete>,
  input: { db: LobeChatDatabase; userId: string },
): Promise<ClientRuntimeCompleteHydrationResult> => {
  if (sourceEvent.payload.status !== 'completed') {
    return skipped('non-completed-status');
  }

  const { assistantMessageId } = sourceEvent.payload;

  if (typeof assistantMessageId !== 'string') {
    return skipped('missing-assistant-message-id');
  }

  const messageModel = new MessageModel(input.db, input.userId);
  const assistantMessage = await messageModel.findById(assistantMessageId);

  if (!assistantMessage) {
    return skipped('assistant-message-not-found');
  }

  if (assistantMessage.role !== 'assistant') {
    return skipped('non-assistant-message');
  }

  if (typeof assistantMessage.parentId !== 'string') {
    return skipped('missing-parent-message-id');
  }

  const parentMessage = await messageModel.findById(assistantMessage.parentId);

  if (!parentMessage) {
    return skipped('parent-message-not-found');
  }

  if (parentMessage.role !== 'user') {
    return skipped('non-user-parent');
  }

  if (!parentMessage.content) {
    return skipped('empty-content');
  }

  const trustedTopicId = parentMessage.topicId ?? assistantMessage.topicId;

  return {
    contextBoundaryMessageId: assistantMessage.id,
    contextEndAt: assistantMessage.updatedAt ?? assistantMessage.createdAt,
    diagnostic: {
      kind: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
      status: 'resolved',
    },
    source: {
      payload: {
        agentId: parentMessage.agentId ?? assistantMessage.agentId ?? sourceEvent.payload.agentId,
        message: parentMessage.content,
        messageId: parentMessage.id,
        threadId:
          parentMessage.threadId ?? assistantMessage.threadId ?? sourceEvent.payload.threadId,
        topicId: trustedTopicId ?? sourceEvent.payload.topicId,
        trigger: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
      },
      scopeKey: getTrustedScopeKey(trustedTopicId, sourceEvent.scopeKey),
      sourceId: getHydratedSourceId(assistantMessage.id, parentMessage.id),
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage,
      timestamp: sourceEvent.timestamp,
    },
  };
};
