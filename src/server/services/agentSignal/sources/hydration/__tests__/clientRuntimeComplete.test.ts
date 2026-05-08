// @vitest-environment node
import type { AgentSignalSourceEvent } from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { messages, topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { describe, expect, it } from 'vitest';

import { uuid } from '@/utils/uuid';

import { resolveClientRuntimeCompleteFeedbackSource } from '../clientRuntimeComplete';

const createCompleteSource = (
  payload: Partial<
    AgentSignalSourceEvent<typeof AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete>['payload']
  > = {},
): AgentSignalSourceEvent<typeof AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete> => ({
  payload: {
    agentId: 'client-agent',
    assistantMessageId: 'assistant-1',
    operationId: 'op-1',
    status: 'completed',
    threadId: 'client-thread',
    topicId: 'client-topic',
    ...payload,
  },
  scopeKey: 'topic:client-topic',
  sourceId: 'op-1:client:complete',
  sourceType: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
  timestamp: 123,
});

describe('resolveClientRuntimeCompleteFeedbackSource', () => {
  /**
   * @example
   * client.runtime.complete({ assistantMessageId }) hydrates a trusted parent user source with an assistant context boundary.
   */
  it('hydrates an assistant completion into the parent agent user message source', async () => {
    const db = await getTestDB();
    const userId = `user_${uuid()}`;
    const topicId = `topic_${uuid()}`;
    const parentMessageId = `msg_${uuid()}`;
    const assistantMessageId = `msg_${uuid()}`;

    await db.insert(users).values({ id: userId });
    await db.insert(topics).values({ id: topicId, title: 'Workflow Topic', userId });
    await db.insert(messages).values({
      content: 'Please remember this workflow.',
      id: parentMessageId,
      role: 'user',
      topicId,
      userId,
    });
    await db.insert(messages).values({
      content: 'I can remember that.',
      id: assistantMessageId,
      parentId: parentMessageId,
      role: 'assistant',
      topicId,
      userId,
    });

    const result = await resolveClientRuntimeCompleteFeedbackSource(
      createCompleteSource({
        assistantMessageId,
        operationId: 'op-success',
        serializedContext: 'client context must not be trusted',
        topicId: 'client-topic',
      }),
      { db, userId },
    );

    expect(result.diagnostic).toEqual({
      kind: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
      status: 'resolved',
    });
    expect(result.contextBoundaryMessageId).toBe(assistantMessageId);
    expect(result.contextEndAt).toBeInstanceOf(Date);
    expect(result.source).toEqual({
      payload: {
        agentId: 'client-agent',
        message: 'Please remember this workflow.',
        messageId: parentMessageId,
        threadId: 'client-thread',
        topicId,
        trigger: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
      },
      scopeKey: `topic:${topicId}`,
      sourceId: `${assistantMessageId}:completion:${parentMessageId}`,
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage,
      timestamp: 123,
    });
    expect(result.source?.payload.serializedContext).toBeUndefined();
  });

  /**
   * @example
   * client.runtime.complete({}) cannot hydrate without an assistant message id.
   */
  it('returns a skipped diagnostic when the completion event has no assistant message id', async () => {
    const db = await getTestDB();

    const result = await resolveClientRuntimeCompleteFeedbackSource(
      createCompleteSource({ assistantMessageId: undefined }),
      { db, userId: `user_${uuid()}` },
    );

    expect(result).toEqual({
      diagnostic: {
        kind: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
        reason: 'missing-assistant-message-id',
        status: 'skipped',
      },
    });
  });

  /**
   * @example
   * client.runtime.complete({ status: "cancelled" }) is not final successful evidence.
   */
  it('returns a skipped diagnostic when completion status is cancelled or failed', async () => {
    const db = await getTestDB();
    const userId = `user_${uuid()}`;

    const cancelled = await resolveClientRuntimeCompleteFeedbackSource(
      createCompleteSource({ status: 'cancelled' }),
      { db, userId },
    );
    const failed = await resolveClientRuntimeCompleteFeedbackSource(
      createCompleteSource({ status: 'failed' }),
      { db, userId },
    );
    const missing = await resolveClientRuntimeCompleteFeedbackSource(
      createCompleteSource({ status: undefined }),
      { db, userId },
    );

    expect(cancelled).toEqual({
      diagnostic: {
        kind: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
        reason: 'non-completed-status',
        status: 'skipped',
      },
    });
    expect(failed).toEqual({
      diagnostic: {
        kind: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
        reason: 'non-completed-status',
        status: 'skipped',
      },
    });
    expect(missing).toEqual({
      diagnostic: {
        kind: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
        reason: 'non-completed-status',
        status: 'skipped',
      },
    });
  });

  /**
   * @example
   * client.runtime.complete({ assistantMessageId: "missing" }) skips when the assistant row is absent.
   */
  it('returns a skipped diagnostic when the assistant message cannot be found', async () => {
    const db = await getTestDB();
    const userId = `user_${uuid()}`;

    await db.insert(users).values({ id: userId });

    const result = await resolveClientRuntimeCompleteFeedbackSource(
      createCompleteSource({ assistantMessageId: `msg_${uuid()}` }),
      { db, userId },
    );

    expect(result).toEqual({
      diagnostic: {
        kind: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
        reason: 'assistant-message-not-found',
        status: 'skipped',
      },
    });
  });

  /**
   * @example
   * client.runtime.complete must verify the assistant row role before trusting its parent.
   */
  it('returns a skipped diagnostic when the assistant message is not an assistant', async () => {
    const db = await getTestDB();
    const userId = `user_${uuid()}`;
    const topicId = `topic_${uuid()}`;
    const assistantMessageId = `msg_${uuid()}`;

    await db.insert(users).values({ id: userId });
    await db.insert(topics).values({ id: topicId, title: 'Workflow Topic', userId });
    await db.insert(messages).values({
      content: 'User row cannot be the assistant completion.',
      id: assistantMessageId,
      role: 'user',
      topicId,
      userId,
    });

    const result = await resolveClientRuntimeCompleteFeedbackSource(
      createCompleteSource({ assistantMessageId }),
      { db, userId },
    );

    expect(result).toEqual({
      diagnostic: {
        kind: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
        reason: 'non-assistant-message',
        status: 'skipped',
      },
    });
  });

  /**
   * @example
   * client.runtime.complete cannot infer user feedback when the assistant row has no parent id.
   */
  it('returns a skipped diagnostic when the assistant message has no parent id', async () => {
    const db = await getTestDB();
    const userId = `user_${uuid()}`;
    const topicId = `topic_${uuid()}`;
    const assistantMessageId = `msg_${uuid()}`;

    await db.insert(users).values({ id: userId });
    await db.insert(topics).values({ id: topicId, title: 'Workflow Topic', userId });
    await db.insert(messages).values({
      content: 'Assistant without parent.',
      id: assistantMessageId,
      role: 'assistant',
      topicId,
      userId,
    });

    const result = await resolveClientRuntimeCompleteFeedbackSource(
      createCompleteSource({ assistantMessageId }),
      { db, userId },
    );

    expect(result).toEqual({
      diagnostic: {
        kind: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
        reason: 'missing-parent-message-id',
        status: 'skipped',
      },
    });
  });

  /**
   * @example
   * client.runtime.complete skips when the assistant parent row is outside the current user boundary.
   */
  it('returns a skipped diagnostic when the parent message cannot be found', async () => {
    const db = await getTestDB();
    const userId = `user_${uuid()}`;
    const otherUserId = `user_${uuid()}`;
    const topicId = `topic_${uuid()}`;
    const otherTopicId = `topic_${uuid()}`;
    const parentMessageId = `msg_${uuid()}`;
    const assistantMessageId = `msg_${uuid()}`;

    await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
    await db.insert(topics).values([
      { id: topicId, title: 'Workflow Topic', userId },
      { id: otherTopicId, title: 'Other Topic', userId: otherUserId },
    ]);
    await db.insert(messages).values({
      content: 'Other user parent.',
      id: parentMessageId,
      role: 'user',
      topicId: otherTopicId,
      userId: otherUserId,
    });
    await db.insert(messages).values({
      content: 'Assistant references a row outside current user scope.',
      id: assistantMessageId,
      parentId: parentMessageId,
      role: 'assistant',
      topicId,
      userId,
    });

    const result = await resolveClientRuntimeCompleteFeedbackSource(
      createCompleteSource({ assistantMessageId }),
      { db, userId },
    );

    expect(result).toEqual({
      diagnostic: {
        kind: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
        reason: 'parent-message-not-found',
        status: 'skipped',
      },
    });
  });

  /**
   * @example
   * client.runtime.complete must verify the assistant parent is a persisted user message.
   */
  it('returns a skipped diagnostic when the parent message is not a user message', async () => {
    const db = await getTestDB();
    const userId = `user_${uuid()}`;
    const topicId = `topic_${uuid()}`;
    const parentMessageId = `msg_${uuid()}`;
    const assistantMessageId = `msg_${uuid()}`;

    await db.insert(users).values({ id: userId });
    await db.insert(topics).values({ id: topicId, title: 'Workflow Topic', userId });
    await db.insert(messages).values({
      content: 'Assistant parent cannot be feedback.',
      id: parentMessageId,
      role: 'assistant',
      topicId,
      userId,
    });
    await db.insert(messages).values({
      content: 'Assistant child.',
      id: assistantMessageId,
      parentId: parentMessageId,
      role: 'assistant',
      topicId,
      userId,
    });

    const result = await resolveClientRuntimeCompleteFeedbackSource(
      createCompleteSource({ assistantMessageId }),
      { db, userId },
    );

    expect(result).toEqual({
      diagnostic: {
        kind: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
        reason: 'non-user-parent',
        status: 'skipped',
      },
    });
  });

  /**
   * @example
   * client.runtime.complete with an empty persisted user message cannot produce feedback text.
   */
  it('returns a skipped diagnostic when the parent message has empty content', async () => {
    const db = await getTestDB();
    const userId = `user_${uuid()}`;
    const topicId = `topic_${uuid()}`;
    const parentMessageId = `msg_${uuid()}`;
    const assistantMessageId = `msg_${uuid()}`;

    await db.insert(users).values({ id: userId });
    await db.insert(topics).values({ id: topicId, title: 'Workflow Topic', userId });
    await db.insert(messages).values({
      content: '',
      id: parentMessageId,
      role: 'user',
      topicId,
      userId,
    });
    await db.insert(messages).values({
      content: 'Assistant child.',
      id: assistantMessageId,
      parentId: parentMessageId,
      role: 'assistant',
      topicId,
      userId,
    });

    const result = await resolveClientRuntimeCompleteFeedbackSource(
      createCompleteSource({ assistantMessageId }),
      { db, userId },
    );

    expect(result).toEqual({
      diagnostic: {
        kind: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
        reason: 'empty-content',
        status: 'skipped',
      },
    });
  });

  /**
   * @example
   * client.runtime.complete with mismatched client topic metadata uses trusted persisted topic and scope.
   */
  it('does not let mismatched client scope or payload topic override trusted server rows', async () => {
    const db = await getTestDB();
    const userId = `user_${uuid()}`;
    const topicId = `topic_${uuid()}`;
    const parentMessageId = `msg_${uuid()}`;
    const assistantMessageId = `msg_${uuid()}`;

    await db.insert(users).values({ id: userId });
    await db.insert(topics).values({ id: topicId, title: 'Workflow Topic', userId });
    await db.insert(messages).values({
      content: 'Persisted topic should win.',
      id: parentMessageId,
      role: 'user',
      topicId,
      userId,
    });
    await db.insert(messages).values({
      content: 'Assistant child.',
      id: assistantMessageId,
      parentId: parentMessageId,
      role: 'assistant',
      topicId,
      userId,
    });

    const result = await resolveClientRuntimeCompleteFeedbackSource(
      {
        ...createCompleteSource({
          assistantMessageId,
          operationId: 'op-scope',
          topicId: 'client-topic',
        }),
        scopeKey: 'topic:client-topic',
      },
      { db, userId },
    );

    expect(result.diagnostic).toEqual({
      kind: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete,
      status: 'resolved',
    });
    expect(result.source?.payload.topicId).toBe(topicId);
    expect(result.source?.scopeKey).toBe(`topic:${topicId}`);
    expect(result.source?.sourceId).toBe(`${assistantMessageId}:completion:${parentMessageId}`);
  });
});
