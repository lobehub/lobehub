// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { recomputeTopicUsage } from '../../topicUsage';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'topic-usage-user';
const otherUserId = 'topic-usage-other-user';
const topicId = 'topic-usage-topic';

interface UsageInput {
  [field: string]: number | undefined;
  cost?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalTokens?: number;
}

let msgSeq = 0;

const insertAssistantMessage = async (params: {
  cost?: number;
  duration?: number;
  id?: string;
  model?: string;
  provider?: string;
  role?: string;
  userId?: string;
  // when omitted, the message carries no `metadata.usage` and must be excluded
  usage?: UsageInput | null;
}) => {
  const id = params.id ?? `msg-${(msgSeq += 1)}`;
  const usage =
    params.usage === null
      ? undefined
      : { ...params.usage, ...(params.cost == null ? {} : { cost: params.cost }) };

  const metadata =
    params.usage === null
      ? { tps: 1 } // realistic non-usage metadata (e.g. content-only)
      : {
          performance: params.duration == null ? undefined : { duration: params.duration },
          usage,
        };

  await serverDB.insert(messages).values({
    id,
    metadata,
    model: params.model ?? 'gpt-4o',
    provider: params.provider ?? 'openai',
    role: params.role ?? 'assistant',
    topicId,
    userId: params.userId ?? userId,
  });
  return id;
};

const recompute = (uid = userId, tid = topicId) =>
  serverDB.transaction((trx) => recomputeTopicUsage(trx, uid, tid));

const getTopic = async (id = topicId) => {
  const [row] = await serverDB.select().from(topics).where(eq(topics.id, id));
  return row;
};

beforeEach(async () => {
  msgSeq = 0;
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values({ id: topicId, userId });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('recomputeTopicUsage', () => {
  it('rolls a single assistant message into scalar totals, usage and cost jsonb', async () => {
    await insertAssistantMessage({
      cost: 0.0021,
      duration: 1200,
      model: 'gpt-4o',
      provider: 'openai',
      usage: {
        inputTextTokens: 100,
        outputTextTokens: 50,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      },
    });

    await recompute();
    const topic = await getTopic();

    expect(topic.totalInputTokens).toBe(100);
    expect(topic.totalOutputTokens).toBe(50);
    expect(topic.totalTokens).toBe(150);
    expect(topic.totalCost).toBeCloseTo(0.0021, 6);
    expect(topic.model).toBe('gpt-4o');
    expect(topic.provider).toBe('openai');

    expect(topic.usage).toEqual({
      humanInteraction: {
        approvalRequests: 0,
        promptRequests: 0,
        selectRequests: 0,
        totalWaitingTimeMs: 0,
      },
      llm: {
        apiCalls: 1,
        processingTimeMs: 1200,
        tokens: { input: 100, output: 50, total: 150 },
      },
      tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
    });

    expect(topic.cost).toMatchObject({
      currency: 'USD',
      llm: {
        byModel: [
          {
            id: 'openai/gpt-4o',
            model: 'gpt-4o',
            provider: 'openai',
            totalCost: 0.0021,
            usage: expect.objectContaining({
              cost: 0.0021,
              totalInputTokens: 100,
              totalOutputTokens: 50,
              totalTokens: 150,
            }),
          },
        ],
        currency: 'USD',
      },
      tools: { byTool: [], currency: 'USD', total: 0 },
    });
    expect((topic.cost as any).total).toBeCloseTo(0.0021, 6);
    expect((topic.cost as any).llm.total).toBeCloseTo(0.0021, 6);
  });

  it('groups by (provider, model) and sums per group; apiCalls counts messages', async () => {
    // two gpt-4o calls + one claude call
    await insertAssistantMessage({
      cost: 0.002,
      duration: 100,
      model: 'gpt-4o',
      provider: 'openai',
      usage: { totalInputTokens: 80, totalOutputTokens: 40, totalTokens: 120 },
    });
    await insertAssistantMessage({
      cost: 0.001,
      duration: 200,
      model: 'gpt-4o',
      provider: 'openai',
      usage: { totalInputTokens: 50, totalOutputTokens: 30, totalTokens: 80 },
    });
    await insertAssistantMessage({
      cost: 0.005,
      duration: 300,
      model: 'claude-3-5-sonnet',
      provider: 'anthropic',
      usage: { totalInputTokens: 200, totalOutputTokens: 100, totalTokens: 300 },
    });

    await recompute();
    const topic = await getTopic();

    expect(topic.totalInputTokens).toBe(330);
    expect(topic.totalOutputTokens).toBe(170);
    expect(topic.totalTokens).toBe(500);
    expect(topic.totalCost).toBeCloseTo(0.008, 6);

    const usage = topic.usage as any;
    expect(usage.llm.apiCalls).toBe(3);
    expect(usage.llm.processingTimeMs).toBe(600);
    expect(usage.llm.tokens).toEqual({ input: 330, output: 170, total: 500 });

    // dominant model = largest token volume (claude 300 > gpt-4o 200)
    expect(topic.model).toBe('claude-3-5-sonnet');
    expect(topic.provider).toBe('anthropic');

    const byModel = (topic.cost as any).llm.byModel as any[];
    expect(byModel).toHaveLength(2);
    const gpt = byModel.find((m) => m.id === 'openai/gpt-4o');
    const claude = byModel.find((m) => m.id === 'anthropic/claude-3-5-sonnet');
    expect(gpt.totalCost).toBeCloseTo(0.003, 6);
    expect(gpt.usage.totalTokens).toBe(200);
    expect(claude.totalCost).toBeCloseTo(0.005, 6);
    expect(claude.usage.totalTokens).toBe(300);
  });

  it('only counts role=assistant messages with metadata.usage', async () => {
    // counted
    await insertAssistantMessage({
      cost: 0.01,
      usage: { totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 },
    });
    // excluded: a user message (even if it somehow had usage)
    await insertAssistantMessage({
      cost: 0.99,
      role: 'user',
      usage: { totalInputTokens: 999, totalOutputTokens: 999, totalTokens: 999 },
    });
    // excluded: assistant message without metadata.usage (content-only)
    await insertAssistantMessage({ role: 'assistant', usage: null });

    await recompute();
    const topic = await getTopic();

    expect(topic.totalTokens).toBe(15);
    expect((topic.usage as any).llm.apiCalls).toBe(1);
    expect(topic.totalCost).toBeCloseTo(0.01, 6);
  });

  it('scopes the rollup to the given userId', async () => {
    await insertAssistantMessage({
      cost: 0.01,
      usage: { totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 },
    });
    // a different user's message sitting under the same topic id must be ignored
    await insertAssistantMessage({
      cost: 0.5,
      userId: otherUserId,
      usage: { totalInputTokens: 500, totalOutputTokens: 500, totalTokens: 1000 },
    });

    await recompute();
    const topic = await getTopic();

    expect(topic.totalTokens).toBe(15);
    expect(topic.totalCost).toBeCloseTo(0.01, 6);
  });

  it('leaves cost NULL when no model reported a cost, but still sums tokens', async () => {
    await insertAssistantMessage({
      usage: { totalInputTokens: 30, totalOutputTokens: 20, totalTokens: 50 },
    });

    await recompute();
    const topic = await getTopic();

    expect(topic.totalTokens).toBe(50);
    expect(topic.totalInputTokens).toBe(30);
    expect(topic.totalCost).toBeNull();
    expect(topic.cost).toBeNull();
    // usage jsonb is still populated
    expect((topic.usage as any).llm.tokens.total).toBe(50);
  });

  it('resets every rollup column to NULL when no measurable usage remains', async () => {
    // first populate
    const id = await insertAssistantMessage({
      cost: 0.02,
      usage: { totalInputTokens: 40, totalOutputTokens: 10, totalTokens: 50 },
    });
    await recompute();
    expect((await getTopic()).totalTokens).toBe(50);

    // remove the only assistant message → nothing left to measure
    await serverDB.delete(messages).where(eq(messages.id, id));
    await recompute();

    const topic = await getTopic();
    expect(topic.totalInputTokens).toBeNull();
    expect(topic.totalOutputTokens).toBeNull();
    expect(topic.totalTokens).toBeNull();
    expect(topic.totalCost).toBeNull();
    expect(topic.usage).toBeNull();
    expect(topic.cost).toBeNull();
    expect(topic.model).toBeNull();
    expect(topic.provider).toBeNull();
  });
});
