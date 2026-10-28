// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, messagePlugins, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { createProxyTestDB } from '../../__tests__/_proxyTestDB';
import { AgentSignalReviewContextModel } from '../reviewContext';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'review-context-coverage-user';
const agentId = 'review-context-coverage-agent';
const topicId = 'review-context-coverage-topic';
const messageId = 'review-context-coverage-tool';

afterEach(async () => {
  // Agents, topics, messages and plugins cascade with their owner.
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('AgentSignalReviewContextModel coverage', () => {
  /**
   * node-postgres in this repo hands `MIN`/`MAX` of a timestamptz back as a string, but a driver
   * keeping pg's default parsers returns a `Date`; both must come out as the same instant.
   */
  it('keeps usage timestamps a driver already parsed into Date objects', async () => {
    await serverDB.insert(users).values({ id: userId });
    await serverDB.insert(agents).values({ id: agentId, title: 'Review Context Agent', userId });
    await serverDB.insert(topics).values({ agentId, id: topicId, title: 'Date topic', userId });
    await serverDB.insert(messages).values({
      agentId,
      content: 'created document',
      createdAt: new Date('2026-05-03T12:00:00.000Z'),
      id: messageId,
      role: 'assistant',
      topicId,
      userId,
    });
    await serverDB.insert(messagePlugins).values({
      apiName: 'createDocument',
      id: messageId,
      identifier: 'lobe-agent-documents',
      toolCallId: 'review-context-coverage-call',
      userId,
    });

    // Raw driver rows go through its default type parsers, so timestamps arrive as Date.
    const dateParsingDB = createProxyTestDB(serverDB);

    const result = await new AgentSignalReviewContextModel(dateParsingDB, userId).listToolActivity({
      agentId,
      windowEnd: new Date('2026-05-03T23:59:59.999Z'),
      windowStart: new Date('2026-05-03T00:00:00.000Z'),
    });

    expect(result).toHaveLength(1);
    expect(result[0].firstUsedAt).toEqual(new Date('2026-05-03T12:00:00.000Z'));
    expect(result[0].lastUsedAt).toEqual(new Date('2026-05-03T12:00:00.000Z'));
  });
});
