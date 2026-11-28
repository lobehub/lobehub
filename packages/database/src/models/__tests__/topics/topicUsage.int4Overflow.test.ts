// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'topic-usage-overflow-user';
const topicId = 'topic-usage-overflow-topic';
const messageModel = new MessageModel(serverDB, userId);

/** Previous rollup the topic already holds, just under the int4 limit. */
const PREVIOUS_TOTAL = 2_147_000_000;

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({
    id: topicId,
    totalInputTokens: 2_100_000_000,
    totalOutputTokens: 47_000_000,
    totalTokens: PREVIOUS_TOTAL,
    userId,
  });
  // History whose totals already sit just under int4.
  await serverDB.insert(messages).values({
    id: 'history-msg',
    model: 'gpt-4o',
    provider: 'openai',
    role: 'assistant',
    topicId,
    usage: {
      cost: 1,
      totalInputTokens: 2_100_000_000,
      totalOutputTokens: 47_000_000,
      totalTokens: PREVIOUS_TOTAL,
    },
    userId,
  });
  await serverDB.insert(messages).values({
    id: 'reply-msg',
    model: 'gpt-4o',
    provider: 'openai',
    role: 'assistant',
    topicId,
    userId,
  });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('topic usage rollup past int4', () => {
  it('still saves the assistant reply when the topic token total exceeds int4', async () => {
    const usage = {
      cost: 0.5,
      totalInputTokens: 900_000,
      totalOutputTokens: 1000,
      totalTokens: 901_000,
    };

    const result = await messageModel.update('reply-msg', {
      content: 'final answer',
      metadata: { usage } as any,
    });

    expect(result).toEqual({ success: true });

    const [reply] = await serverDB.select().from(messages).where(eq(messages.id, 'reply-msg'));
    expect(reply.content).toBe('final answer');
    expect(reply.usage).toEqual(usage);

    const [topic] = await serverDB.select().from(topics).where(eq(topics.id, topicId));
    // bigint columns hold totals past the int4 limit (2,147,483,647).
    expect(topic.totalTokens).toBe(PREVIOUS_TOTAL + 901_000);
    expect(topic.totalInputTokens).toBe(2_100_900_000);
    expect(topic.totalOutputTokens).toBe(47_001_000);
    // The jsonb rollup and cost still carry the true totals.
    expect((topic.usage as any).llm.tokens.total).toBe(PREVIOUS_TOTAL + 901_000);
    expect(topic.totalCost).toBeCloseTo(1.5, 6);
  });
});
