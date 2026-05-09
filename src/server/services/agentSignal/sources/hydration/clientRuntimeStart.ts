import type {
  SourceEventAgentUserMessage,
  SourceEventClientRuntimeStart,
} from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import { MessageModel } from '@/database/models/message';
import type { LobeChatDatabase } from '@/database/type';

/** Reason a `client.runtime.start` event could not become a feedback source. */
export type ClientRuntimeStartHydrationSkipReason =
  | 'empty-content'
  | 'message-not-found'
  | 'missing-parent-message-id'
  | 'non-user-parent';

/** Diagnostic emitted while hydrating a client runtime-start source. */
export interface ClientRuntimeStartHydrationDiagnostic {
  /** Stable skip reason for tracing when `status` is `skipped`. */
  reason?: ClientRuntimeStartHydrationSkipReason;
  /** Whether hydration produced a trusted server source. */
  status: 'resolved' | 'skipped';
}

/** Result of client runtime-start source hydration. */
export interface ClientRuntimeStartHydrationResult {
  /** Trace-safe hydration status and optional skip reason. */
  diagnostic: ClientRuntimeStartHydrationDiagnostic;
  /** Hydrated feedback source, present only when `diagnostic.status` is `resolved`. */
  source?: SourceEventAgentUserMessage;
}

const getTrustedScopeKey = (
  trustedTopicId: string | null | undefined,
  fallbackScopeKey: string,
) => {
  return trustedTopicId ? `topic:${trustedTopicId}` : fallbackScopeKey;
};

/**
 * Resolves a client runtime-start event into a trusted feedback source.
 *
 * Use when:
 * - The browser emitted only `client.runtime.start`.
 * - Feedback policies need server-owned user message content and ids.
 *
 * Expects:
 * - `sourceEvent.payload.parentMessageType === "user"` for hydratable events.
 * - `sourceEvent.payload.parentMessageId` belongs to the current user.
 *
 * Returns:
 * - A hydrated `agent.user.message` source with the parent message content.
 * - A skipped diagnostic when the client event cannot safely become feedback.
 */
export const resolveClientRuntimeStartFeedbackSource = async (
  sourceEvent: SourceEventClientRuntimeStart,
  input: { db: LobeChatDatabase; userId: string },
): Promise<ClientRuntimeStartHydrationResult> => {
  if (sourceEvent.payload.parentMessageType !== 'user') {
    return { diagnostic: { reason: 'non-user-parent', status: 'skipped' } };
  }

  if (typeof sourceEvent.payload.parentMessageId !== 'string') {
    return { diagnostic: { reason: 'missing-parent-message-id', status: 'skipped' } };
  }

  const messageModel = new MessageModel(input.db, input.userId);
  const parentMessage = await messageModel.findById(sourceEvent.payload.parentMessageId);

  if (!parentMessage) {
    return { diagnostic: { reason: 'message-not-found', status: 'skipped' } };
  }

  if (parentMessage.role !== 'user') {
    return { diagnostic: { reason: 'non-user-parent', status: 'skipped' } };
  }

  if (!parentMessage.content) {
    return { diagnostic: { reason: 'empty-content', status: 'skipped' } };
  }

  return {
    diagnostic: { status: 'resolved' },
    source: {
      payload: {
        agentId: parentMessage.agentId ?? sourceEvent.payload.agentId,
        message: parentMessage.content,
        messageId: parentMessage.id,
        threadId: parentMessage.threadId ?? sourceEvent.payload.threadId,
        topicId: parentMessage.topicId ?? sourceEvent.payload.topicId,
        trigger: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeStart,
      },
      scopeKey: getTrustedScopeKey(parentMessage.topicId, sourceEvent.scopeKey),
      sourceId: parentMessage.id,
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage,
      timestamp: sourceEvent.timestamp,
    },
  };
};
