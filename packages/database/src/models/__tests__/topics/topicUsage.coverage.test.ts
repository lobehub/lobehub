// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations, messages, topics, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { recomputeTopicUsage } from '../../topicUsage';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'topic-usage-coverage-user';
const memberId = 'topic-usage-coverage-member';
const topicId = 'topic-usage-coverage-topic';

let seq = 0;

const insertOperation = async (values: {
  cost?: Record<string, unknown> | null;
  model?: string | null;
  provider?: string | null;
  usage?: Record<string, unknown> | null;
  userId?: string;
  workspaceId?: string;
}) => {
  seq += 1;
  await serverDB.insert(agentOperations).values({
    cost: values.cost ?? null,
    id: `topic-usage-coverage-op-${seq}`,
    model: values.model ?? null,
    provider: values.provider ?? null,
    status: 'done',
    topicId,
    usage: values.usage ?? null,
    userId: values.userId ?? userId,
    workspaceId: values.workspaceId ?? null,
  });
};

const insertAssistantMessage = async (values: {
  model?: string | null;
  provider?: string | null;
  usage: Record<string, number>;
  userId?: string;
  workspaceId?: string;
}) => {
  seq += 1;
  await serverDB.insert(messages).values({
    id: `topic-usage-coverage-msg-${seq}`,
    model: values.model ?? null,
    provider: values.provider ?? null,
    role: 'assistant',
    topicId,
    usage: values.usage,
    userId: values.userId ?? userId,
    workspaceId: values.workspaceId ?? null,
  });
};

const recompute = (workspaceId?: string) =>
  serverDB.transaction((trx) => recomputeTopicUsage(trx, userId, topicId, workspaceId));

const getTopic = async () => {
  const [row] = await serverDB.select().from(topics).where(eq(topics.id, topicId));
  return row;
};

const cleanup = async () => {
  // agent_operations.user_id has no FK, so its rows do not cascade with the user.
  await serverDB.delete(agentOperations).where(inArray(agentOperations.userId, [userId, memberId]));
  await serverDB.delete(workspaces).where(eq(workspaces.primaryOwnerId, userId));
  await serverDB.delete(users).where(inArray(users.id, [userId, memberId]));
};

beforeEach(async () => {
  seq = 0;
  await cleanup();
  await serverDB.insert(users).values([{ id: userId }, { id: memberId }]);
});

afterEach(cleanup);

describe('recomputeTopicUsage coverage', () => {
  describe('operation blobs with partial shapes', () => {
    beforeEach(async () => {
      await serverDB.insert(topics).values({ id: topicId, userId });
    });

    it('counts tool totals without a byTool list and skips unnamed entries', async () => {
      await insertOperation({
        cost: { tools: { total: 0.5 }, total: 0.5 },
        usage: { tools: { totalCalls: 2, totalTimeMs: 40 } },
      });
      await insertOperation({
        cost: {
          tools: {
            byTool: [
              null,
              { calls: 1, totalCost: 9 },
              { calls: 1, name: 'search', totalCost: 0.25 },
            ],
            total: 0.25,
          },
          total: 0.25,
        },
        usage: {
          tools: {
            byTool: [
              null,
              { calls: 3, totalTimeMs: 9 },
              { calls: 1, name: 'search', totalTimeMs: 10 },
            ],
            totalCalls: 1,
            totalTimeMs: 10,
          },
        },
      });

      await recompute();
      const topic = await getTopic();

      expect(topic.usage).toMatchObject({
        tools: {
          byTool: [{ calls: 1, errors: 0, name: 'search', totalTimeMs: 10 }],
          totalCalls: 3,
          totalTimeMs: 50,
        },
      });
      expect(topic.cost).toMatchObject({
        llm: { byModel: [], total: 0 },
        tools: { byTool: [{ calls: 1, name: 'search', totalCost: 0.25 }], total: 0.75 },
        total: 0.75,
      });
      expect(topic.totalCost).toBeCloseTo(0.75, 6);
    });

    it('merges repeated tool cost entries by name', async () => {
      await insertOperation({
        cost: {
          tools: {
            byTool: [
              { calls: 1, name: 'fetch', totalCost: 0.1 },
              { calls: 2, name: 'fetch', totalCost: 0.2 },
            ],
            total: 0.3,
          },
          total: 0.3,
        },
      });

      await recompute();

      expect((await getTopic()).cost).toMatchObject({
        tools: { byTool: [{ calls: 3, currency: 'USD', name: 'fetch' }] },
      });
      expect(((await getTopic()).cost as any).tools.byTool[0].totalCost).toBeCloseTo(0.3, 6);
    });

    it('adds no unitemized LLM cost when the op total is all tool cost', async () => {
      await insertOperation({
        cost: { tools: { byTool: [], total: 0.4 }, total: 0.4 },
        model: 'm',
        provider: 'p',
      });

      await recompute();
      const topic = await getTopic();

      expect(topic.cost).toMatchObject({ llm: { byModel: [], total: 0 }, total: 0.4 });
    });

    it('keys an unitemized LLM cost with no provider or model as unknown', async () => {
      await insertOperation({ cost: { total: 2 } });

      await recompute();

      expect(((await getTopic()).cost as any).llm.byModel).toEqual([
        {
          id: 'unknown/unknown',
          model: null,
          provider: null,
          totalCost: 2,
          usage: { cost: 2 },
        },
      ]);
    });

    it('records message cost for a group with no provider or model', async () => {
      await insertAssistantMessage({ usage: { cost: 1.5, totalTokens: 30 } });

      await recompute();
      const topic = await getTopic();

      expect(topic.totalTokens).toBe(30);
      expect((topic.cost as any).llm.byModel).toEqual([
        {
          id: 'unknown/unknown',
          model: null,
          provider: null,
          totalCost: 1.5,
          usage: { cost: 1.5, totalTokens: 30 },
        },
      ]);
    });
  });

  describe('workspace mode', () => {
    it('rolls up every member row of the workspace and ignores personal rows', async () => {
      const [workspace] = await serverDB
        .insert(workspaces)
        .values({
          name: 'topic-usage-coverage-ws',
          primaryOwnerId: userId,
          slug: 'topic-usage-coverage-ws',
        })
        .returning();
      await serverDB.insert(topics).values({ id: topicId, userId, workspaceId: workspace.id });

      await insertAssistantMessage({
        model: 'm',
        provider: 'p',
        usage: { cost: 1, totalTokens: 10 },
        workspaceId: workspace.id,
      });
      // Another member's message in the same workspace topic counts too.
      await insertAssistantMessage({
        model: 'm',
        provider: 'p',
        usage: { cost: 2, totalTokens: 20 },
        userId: memberId,
        workspaceId: workspace.id,
      });
      // A personal-mode row on the same topic id is outside the workspace scope.
      await insertAssistantMessage({ model: 'm', provider: 'p', usage: { cost: 100 } });
      await insertOperation({
        usage: { humanInteraction: { approvalRequests: 1 } },
        userId: memberId,
        workspaceId: workspace.id,
      });
      await insertOperation({ usage: { humanInteraction: { approvalRequests: 50 } } });

      await recompute(workspace.id);
      const topic = await getTopic();

      expect(topic.totalTokens).toBe(30);
      expect(topic.totalCost).toBeCloseTo(3, 6);
      expect(topic.usage).toMatchObject({
        humanInteraction: { approvalRequests: 1 },
        llm: { apiCalls: 2 },
      });
    });
  });
});
