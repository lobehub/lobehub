// @vitest-environment node
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { messages, topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { describe, expect, it } from 'vitest';

import { uuid } from '@/utils/uuid';

import { resolveClientRuntimeStartFeedbackSource } from '../clientRuntimeStart';

describe('resolveClientRuntimeStartFeedbackSource', { timeout: 15_000 }, () => {
  /**
   * @example
   * client.runtime.start({ parentMessageType: "assistant" }) skips hydration with a traceable reason.
   */
  it('returns a skipped diagnostic when the runtime start parent is not a user message', async () => {
    const db = await getTestDB();

    const result = await resolveClientRuntimeStartFeedbackSource(
      {
        payload: {
          operationId: `op_${uuid()}`,
          parentMessageId: `msg_${uuid()}`,
          parentMessageType: 'assistant',
        },
        scopeKey: 'topic:topic_1',
        sourceId: 'client:start',
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeStart,
        timestamp: Date.now(),
      },
      { db, userId: `user_${uuid()}` },
    );

    expect(result).toEqual({
      diagnostic: {
        reason: 'non-user-parent',
        status: 'skipped',
      },
    });
  });

  /**
   * @example
   * client.runtime.start({ parentMessageId }) hydrates a trusted agent.user.message source.
   */
  it('hydrates a user parent message into an agent user message source', async () => {
    const db = await getTestDB();
    const userId = `user_${uuid()}`;
    const messageId = `msg_${uuid()}`;

    await db.insert(users).values({ id: userId });
    await db.insert(topics).values({ id: 'topic_1', title: 'Workflow Topic', userId });
    await db.insert(messages).values({
      content: 'Nice work. Can we keep this workflow?',
      id: messageId,
      role: 'user',
      topicId: 'topic_1',
      userId,
    });

    const result = await resolveClientRuntimeStartFeedbackSource(
      {
        payload: {
          agentId: 'agent_1',
          operationId: `op_${uuid()}`,
          parentMessageId: messageId,
          parentMessageType: 'user',
          serializedContext: 'client supplied context must not be trusted',
          topicId: 'topic_1',
        },
        scopeKey: 'topic:topic_1',
        sourceId: 'client:start',
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeStart,
        timestamp: Date.now(),
      },
      { db, userId },
    );

    expect(result.diagnostic).toEqual({ status: 'resolved' });
    expect(result.source?.sourceType).toBe(AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage);
    expect(result.source?.sourceId).toBe(messageId);
    expect(result.source?.payload).toMatchObject({
      agentId: 'agent_1',
      message: 'Nice work. Can we keep this workflow?',
      messageId,
      topicId: 'topic_1',
      trigger: 'client.runtime.start',
    });
    expect(result.source?.payload.serializedContext).toBeUndefined();
  });

  /**
   * @example
   * client.runtime.start with mismatched client topic metadata uses trusted persisted topic and scope.
   */
  it('does not let mismatched client scope or payload topic override trusted server rows', async () => {
    const db = await getTestDB();
    const userId = `user_${uuid()}`;
    const trustedTopicId = `topic_${uuid()}`;
    const clientTopicId = `topic_${uuid()}`;
    const messageId = `msg_${uuid()}`;

    await db.insert(users).values({ id: userId });
    await db.insert(topics).values([
      { id: trustedTopicId, title: 'Trusted Topic', userId },
      { id: clientTopicId, title: 'Client Topic', userId },
    ]);
    await db.insert(messages).values({
      content: 'Persisted topic should win for start hydration.',
      id: messageId,
      role: 'user',
      topicId: trustedTopicId,
      userId,
    });

    const result = await resolveClientRuntimeStartFeedbackSource(
      {
        payload: {
          agentId: 'client-agent',
          operationId: `op_${uuid()}`,
          parentMessageId: messageId,
          parentMessageType: 'user',
          threadId: 'client-thread',
          topicId: clientTopicId,
        },
        scopeKey: `topic:${clientTopicId}`,
        sourceId: 'client:start',
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeStart,
        timestamp: Date.now(),
      },
      { db, userId },
    );

    expect(result.diagnostic).toEqual({ status: 'resolved' });
    expect(result.source?.payload.topicId).toBe(trustedTopicId);
    expect(result.source?.scopeKey).toBe(`topic:${trustedTopicId}`);
    expect(result.source?.sourceId).toBe(messageId);
  });

  /**
   * @example
   * client.runtime.start({ parentMessageType: "user" }) without a parent id cannot hydrate.
   */
  it('returns a skipped diagnostic when the runtime start event has no parent message id', async () => {
    const db = await getTestDB();

    const result = await resolveClientRuntimeStartFeedbackSource(
      {
        payload: {
          operationId: `op_${uuid()}`,
          parentMessageType: 'user',
        },
        scopeKey: 'topic:topic_1',
        sourceId: 'client:start',
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeStart,
        timestamp: Date.now(),
      },
      { db, userId: `user_${uuid()}` },
    );

    expect(result).toEqual({
      diagnostic: {
        reason: 'missing-parent-message-id',
        status: 'skipped',
      },
    });
  });

  /**
   * @example
   * client.runtime.start({ parentMessageId: "missing" }) cannot hydrate a source.
   */
  it('returns a skipped diagnostic when the parent message cannot be found', async () => {
    const db = await getTestDB();
    const userId = `user_${uuid()}`;

    await db.insert(users).values({ id: userId });

    const result = await resolveClientRuntimeStartFeedbackSource(
      {
        payload: {
          operationId: `op_${uuid()}`,
          parentMessageId: `msg_${uuid()}`,
          parentMessageType: 'user',
        },
        scopeKey: 'topic:topic_1',
        sourceId: 'client:start',
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeStart,
        timestamp: Date.now(),
      },
      { db, userId },
    );

    expect(result).toEqual({
      diagnostic: {
        reason: 'message-not-found',
        status: 'skipped',
      },
    });
  });

  /**
   * @example
   * client.runtime.start may claim a user parent, but the persisted row must agree.
   */
  it('returns a skipped diagnostic when the persisted parent message is not a user message', async () => {
    const db = await getTestDB();
    const userId = `user_${uuid()}`;
    const messageId = `msg_${uuid()}`;
    const topicId = `topic_${uuid()}`;

    await db.insert(users).values({ id: userId });
    await db.insert(topics).values({ id: topicId, title: 'Workflow Topic', userId });
    await db.insert(messages).values({
      content: 'Assistant text must not be treated as user feedback.',
      id: messageId,
      role: 'assistant',
      topicId,
      userId,
    });

    const result = await resolveClientRuntimeStartFeedbackSource(
      {
        payload: {
          operationId: `op_${uuid()}`,
          parentMessageId: messageId,
          parentMessageType: 'user',
        },
        scopeKey: 'topic:topic_1',
        sourceId: 'client:start',
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeStart,
        timestamp: Date.now(),
      },
      { db, userId },
    );

    expect(result).toEqual({
      diagnostic: {
        reason: 'non-user-parent',
        status: 'skipped',
      },
    });
  });

  /**
   * @example
   * client.runtime.start with an empty persisted user message cannot produce feedback text.
   */
  it('returns a skipped diagnostic when the persisted parent message has empty content', async () => {
    const db = await getTestDB();
    const userId = `user_${uuid()}`;
    const messageId = `msg_${uuid()}`;
    const topicId = `topic_${uuid()}`;

    await db.insert(users).values({ id: userId });
    await db.insert(topics).values({ id: topicId, title: 'Workflow Topic', userId });
    await db.insert(messages).values({
      content: '',
      id: messageId,
      role: 'user',
      topicId,
      userId,
    });

    const result = await resolveClientRuntimeStartFeedbackSource(
      {
        payload: {
          operationId: `op_${uuid()}`,
          parentMessageId: messageId,
          parentMessageType: 'user',
        },
        scopeKey: 'topic:topic_1',
        sourceId: 'client:start',
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeStart,
        timestamp: Date.now(),
      },
      { db, userId },
    );

    expect(result).toEqual({
      diagnostic: {
        reason: 'empty-content',
        status: 'skipped',
      },
    });
  });
});
