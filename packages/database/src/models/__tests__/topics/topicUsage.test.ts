// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations, messages, topics, users } from '../../../schemas';
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

let opSeq = 0;

/**
 * Insert an `agent_operations` row carrying the runtime's own-accumulator
 * usage/cost blobs (the shape `CompletionLifecycle.persistCompletion` writes).
 */
const insertOperation = async (params: {
  cost?: Record<string, unknown> | null;
  id?: string;
  parentOperationId?: string;
  topicId?: string | null;
  usage?: Record<string, unknown> | null;
  userId?: string;
}) => {
  const id = params.id ?? `op-${(opSeq += 1)}`;
  await serverDB.insert(agentOperations).values({
    cost: params.cost ?? null,
    id,
    parentOperationId: params.parentOperationId ?? null,
    status: 'done',
    topicId: params.topicId === undefined ? topicId : params.topicId,
    usage: params.usage ?? null,
    userId: params.userId ?? userId,
  });
  return id;
};

const toolsUsage = (
  byTool: Array<{ calls: number; errors?: number; name: string; totalTimeMs: number }>,
) => ({
  humanInteraction: {
    approvalRequests: 0,
    promptRequests: 0,
    selectRequests: 0,
    totalWaitingTimeMs: 0,
  },
  llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
  tools: {
    byTool: byTool.map((t) => ({ errors: 0, ...t })),
    totalCalls: byTool.reduce((acc, t) => acc + t.calls, 0),
    totalTimeMs: byTool.reduce((acc, t) => acc + t.totalTimeMs, 0),
  },
});

const toolsCost = (byTool: Array<{ calls: number; name: string; totalCost: number }>) => ({
  calculatedAt: '2024-01-01T00:00:00.000Z',
  currency: 'USD',
  llm: { byModel: [], currency: 'USD', total: 0 },
  tools: {
    byTool: byTool.map((t) => ({ currency: 'USD', ...t })),
    currency: 'USD',
    total: byTool.reduce((acc, t) => acc + t.totalCost, 0),
  },
  total: byTool.reduce((acc, t) => acc + t.totalCost, 0),
});

const recompute = (uid = userId, tid = topicId) =>
  serverDB.transaction((trx) => recomputeTopicUsage(trx, uid, tid));

const getTopic = async (id = topicId) => {
  const [row] = await serverDB.select().from(topics).where(eq(topics.id, id));
  return row;
};

beforeEach(async () => {
  msgSeq = 0;
  opSeq = 0;
  await serverDB.delete(users);
  // agent_operations.user_id is intentionally not a FK — clean up explicitly.
  await serverDB.delete(agentOperations);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  // Seed a pinned model on the topic (config). The usage roll-up must NEVER touch
  // these columns — they hold the topic's configured model, not the measured
  // dominant model (which lives in `cost.llm.byModel`).
  await serverDB
    .insert(topics)
    .values({ id: topicId, model: 'pinned-model', provider: 'pinned-provider', userId });
});

afterEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(agentOperations);
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
    // Roll-up preserves the pinned model (config) — it does not write the
    // message's model into the column.
    expect(topic.model).toBe('pinned-model');
    expect(topic.provider).toBe('pinned-provider');

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

    // The measured per-model breakdown lives in `cost.llm.byModel` (below); the
    // roll-up does NOT promote a dominant model into the `model` column, which
    // stays the pinned config.
    expect(topic.model).toBe('pinned-model');
    expect(topic.provider).toBe('pinned-provider');

    const byModel = (topic.cost as any).llm.byModel as any[];
    expect(byModel).toHaveLength(2);
    const gpt = byModel.find((m) => m.id === 'openai/gpt-4o');
    const claude = byModel.find((m) => m.id === 'anthropic/claude-3-5-sonnet');
    expect(gpt.totalCost).toBeCloseTo(0.003, 6);
    expect(gpt.usage.totalTokens).toBe(200);
    expect(claude.totalCost).toBeCloseTo(0.005, 6);
    expect(claude.usage.totalTokens).toBe(300);
  });

  it('prefers the dedicated usage column over metadata.usage', async () => {
    await serverDB.insert(messages).values({
      id: 'col-msg',
      metadata: {
        usage: { cost: 9.9, totalInputTokens: 999, totalOutputTokens: 999, totalTokens: 9999 },
      },
      model: 'gpt-4o',
      provider: 'openai',
      role: 'assistant',
      topicId,
      usage: { cost: 0.01, totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 } as any,
      userId,
    });

    await recompute();
    const topic = await getTopic();

    expect(topic.totalTokens).toBe(15);
    expect(topic.totalCost).toBeCloseTo(0.01, 6);
  });

  it('counts rows that only carry the usage column (no metadata.usage)', async () => {
    await serverDB.insert(messages).values({
      id: 'col-only',
      metadata: { tps: 1 }, // realistic non-usage metadata
      model: 'gpt-4o',
      provider: 'openai',
      role: 'assistant',
      topicId,
      usage: { cost: 0.02, totalInputTokens: 30, totalOutputTokens: 20, totalTokens: 50 } as any,
      userId,
    });

    await recompute();
    const topic = await getTopic();

    expect(topic.totalTokens).toBe(50);
    expect(topic.totalCost).toBeCloseTo(0.02, 6);
    expect((topic.usage as any).llm.apiCalls).toBe(1);
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
    // Usage aggregates reset to NULL, but the pinned model (config) is preserved.
    expect(topic.model).toBe('pinned-model');
    expect(topic.provider).toBe('pinned-provider');
  });

  it('short-circuits when the topic row is missing or owned by another user', async () => {
    await insertAssistantMessage({
      cost: 0.01,
      usage: { totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 },
    });
    await recompute();
    expect((await getTopic()).totalTokens).toBe(15);

    // unknown topic id → the lock read matches nothing; no throw, no effect
    await recompute(userId, 'topic-usage-nonexistent');
    // another user recomputing this topic → not owned; must not reset/overwrite
    await recompute(otherUserId, topicId);

    expect((await getTopic()).totalTokens).toBe(15);
  });

  describe('operation-derived tool usage/cost', () => {
    it('rolls operation tool usage and cost into the topic; totals include tool cost', async () => {
      await insertAssistantMessage({
        cost: 0.002,
        usage: { totalInputTokens: 100, totalOutputTokens: 50, totalTokens: 150 },
      });
      await insertOperation({
        cost: toolsCost([{ calls: 2, name: 'web-search', totalCost: 0.03 }]),
        usage: toolsUsage([{ calls: 2, errors: 1, name: 'web-search', totalTimeMs: 800 }]),
      });

      await recompute();
      const topic = await getTopic();

      expect((topic.usage as any).tools).toEqual({
        byTool: [{ calls: 2, errors: 1, name: 'web-search', totalTimeMs: 800 }],
        totalCalls: 2,
        totalTimeMs: 800,
      });
      expect((topic.cost as any).tools).toEqual({
        byTool: [{ calls: 2, currency: 'USD', name: 'web-search', totalCost: 0.03 }],
        currency: 'USD',
        total: 0.03,
      });
      // llm side stays message-derived; grand totals include the tool spend
      expect((topic.cost as any).llm.total).toBeCloseTo(0.002, 6);
      expect((topic.cost as any).total).toBeCloseTo(0.032, 6);
      expect(topic.totalCost).toBeCloseTo(0.032, 6);
      expect(topic.totalTokens).toBe(150);
    });

    it('merges byTool across operations (same name summed, output sorted by name)', async () => {
      await insertAssistantMessage({
        usage: { totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 },
      });
      await insertOperation({
        usage: toolsUsage([
          { calls: 2, errors: 1, name: 'web-search', totalTimeMs: 500 },
          { calls: 1, name: 'code-runner', totalTimeMs: 300 },
        ]),
      });
      await insertOperation({
        usage: toolsUsage([{ calls: 3, errors: 2, name: 'web-search', totalTimeMs: 700 }]),
      });

      await recompute();
      const topic = await getTopic();

      expect((topic.usage as any).tools).toEqual({
        byTool: [
          { calls: 1, errors: 0, name: 'code-runner', totalTimeMs: 300 },
          { calls: 5, errors: 3, name: 'web-search', totalTimeMs: 1200 },
        ],
        totalCalls: 6,
        totalTimeMs: 1500,
      });
      // no cost anywhere → cost stays NULL even though tools ran
      expect(topic.cost).toBeNull();
      expect(topic.totalCost).toBeNull();
    });

    it('counts a sub-agent child operation once (blobs are per-op own accumulators)', async () => {
      await insertAssistantMessage({
        usage: { totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 },
      });
      const parentId = await insertOperation({
        usage: toolsUsage([{ calls: 1, name: 'callSubAgent', totalTimeMs: 100 }]),
      });
      await insertOperation({
        parentOperationId: parentId,
        usage: toolsUsage([{ calls: 4, name: 'web-search', totalTimeMs: 900 }]),
      });

      await recompute();
      const topic = await getTopic();

      expect((topic.usage as any).tools.totalCalls).toBe(5);
      expect((topic.usage as any).tools.totalTimeMs).toBe(1000);
    });

    it('ignores operations of another user, another topic, or without usage/cost', async () => {
      await insertAssistantMessage({
        usage: { totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 },
      });
      await insertOperation({
        usage: toolsUsage([{ calls: 1, name: 'web-search', totalTimeMs: 100 }]),
      });
      // other user's op under the same topic id
      await insertOperation({
        usage: toolsUsage([{ calls: 9, name: 'web-search', totalTimeMs: 999 }]),
        userId: otherUserId,
      });
      // op without a topic linkage
      await insertOperation({
        topicId: null,
        usage: toolsUsage([{ calls: 9, name: 'web-search', totalTimeMs: 999 }]),
      });
      // running op that has not persisted any usage/cost yet
      await insertOperation({});

      await recompute();
      const topic = await getTopic();

      expect((topic.usage as any).tools).toEqual({
        byTool: [{ calls: 1, errors: 0, name: 'web-search', totalTimeMs: 100 }],
        totalCalls: 1,
        totalTimeMs: 100,
      });
    });

    it('writes a tools-only rollup when operations have data but no assistant usage exists', async () => {
      await insertOperation({
        cost: toolsCost([{ calls: 1, name: 'web-search', totalCost: 0.05 }]),
        usage: toolsUsage([{ calls: 1, name: 'web-search', totalTimeMs: 200 }]),
      });

      await recompute();
      const topic = await getTopic();

      // token scalars stay "not measured"; tool spend is still accounted
      expect(topic.totalInputTokens).toBeNull();
      expect(topic.totalOutputTokens).toBeNull();
      expect(topic.totalTokens).toBeNull();
      // Pinned model (config) is preserved even when usage aggregates reset.
      expect(topic.model).toBe('pinned-model');
      expect(topic.provider).toBe('pinned-provider');
      expect(topic.totalCost).toBeCloseTo(0.05, 6);

      expect((topic.usage as any).llm).toEqual({
        apiCalls: 0,
        processingTimeMs: 0,
        tokens: { input: 0, output: 0, total: 0 },
      });
      expect((topic.usage as any).tools.totalCalls).toBe(1);
      expect((topic.cost as any).llm).toEqual({ byModel: [], currency: 'USD', total: 0 });
      expect((topic.cost as any).total).toBeCloseTo(0.05, 6);
    });

    it('aggregates humanInteraction stats from operations', async () => {
      await insertAssistantMessage({
        usage: { totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 },
      });
      const usage = toolsUsage([]);
      usage.humanInteraction = {
        approvalRequests: 2,
        promptRequests: 1,
        selectRequests: 0,
        totalWaitingTimeMs: 4000,
      };
      await insertOperation({ usage });

      await recompute();
      const topic = await getTopic();

      expect((topic.usage as any).humanInteraction).toEqual({
        approvalRequests: 2,
        promptRequests: 1,
        selectRequests: 0,
        totalWaitingTimeMs: 4000,
      });
    });
  });
});
