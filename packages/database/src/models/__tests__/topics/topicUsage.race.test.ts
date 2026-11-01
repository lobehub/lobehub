import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { recomputeTopicUsage } from '../../topicUsage';

// Real-Postgres reproduction of the lost-update interleave on the topic usage
// rollup (mirrors `topic.updateMetadata.race.test.ts`).
//
// `recomputeTopicUsage` is a read-aggregate-then-write projection. Without the
// up-front `SELECT … FOR UPDATE` on the topic row, two concurrent completions
// can interleave so an older aggregate snapshot overwrites a newer rollup:
// A commits its operation row and reads the aggregates (missing B, not yet
// committed); B commits its op, recomputes A+B and writes it; then A's final
// UPDATE lands with A-only values — the tool spend stays undercounted until
// the next trigger.
//
// Under the client-db PGlite engine concurrent transactions serialize on the
// single session, so this passes trivially there; against a REAL node-postgres
// pool (`TEST_SERVER_DB=1`, separate connections → genuine interleave) it
// guards the row lock: every trial must count BOTH completions.

const userId = 'topic-usage-race-user';
const serverDB: LobeChatDatabase = await getTestDB();

const cleanup = async () => {
  await serverDB.delete(agentOperations).where(eq(agentOperations.userId, userId));
  await serverDB.delete(topics).where(eq(topics.userId, userId));
  await serverDB.delete(users).where(eq(users.id, userId));
};

/** The runtime's own-accumulator blobs for one op with a single tool call. */
const opBlobs = (toolName: string, toolCost: number) => ({
  cost: {
    calculatedAt: '2024-01-01T00:00:00.000Z',
    currency: 'USD',
    llm: { byModel: [], currency: 'USD', total: 0 },
    tools: {
      byTool: [{ calls: 1, currency: 'USD', name: toolName, totalCost: toolCost }],
      currency: 'USD',
      total: toolCost,
    },
    total: toolCost,
  },
  usage: {
    humanInteraction: {
      approvalRequests: 0,
      promptRequests: 0,
      selectRequests: 0,
      totalWaitingTimeMs: 0,
    },
    llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
    tools: {
      byTool: [{ calls: 1, errors: 0, name: toolName, totalTimeMs: 100 }],
      totalCalls: 1,
      totalTimeMs: 100,
    },
  },
});

describe('recomputeTopicUsage — concurrent lost-update (real Postgres)', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values([{ id: userId }]);
  });

  afterAll(cleanup);

  it('serializes concurrent completions so the rollup counts both', async () => {
    const TRIALS = 30;
    let undercounted = 0;

    for (let i = 0; i < TRIALS; i++) {
      const topicId = `usage-race-${i}`;
      await serverDB.insert(topics).values({ id: topicId, title: 't', userId });

      // Mirrors `CompletionLifecycle.persistCompletion`: write the terminal op
      // row, then recompute the topic rollup in its own transaction. Fired
      // concurrently so the read-aggregate-write sections can interleave.
      const complete = async (opId: string, toolName: string, toolCost: number) => {
        await serverDB.insert(agentOperations).values({
          ...opBlobs(toolName, toolCost),
          id: opId,
          status: 'done',
          topicId,
          userId,
        });
        await serverDB.transaction((trx) => recomputeTopicUsage(trx, userId, topicId));
      };

      await Promise.all([
        complete(`op-a-${i}`, 'web-search', 0.01),
        complete(`op-b-${i}`, 'code-runner', 0.02),
      ]);

      const [topic] = await serverDB.select().from(topics).where(eq(topics.id, topicId));
      const totalCalls = (topic?.usage as any)?.tools?.totalCalls;
      const costTotal = (topic?.cost as any)?.total;
      if (totalCalls !== 2 || Math.abs(Number(costTotal) - 0.03) > 1e-9) undercounted++;
    }

    console.log(`[topicUsage race] rollup undercounted in ${undercounted}/${TRIALS} trials`);

    // With the up-front row lock, the later recompute waits and re-reads after
    // the earlier one commits: every trial must include both completions. A
    // single undercount means the lost-update interleave is back.
    expect(undercounted).toBe(0);
  });
});
