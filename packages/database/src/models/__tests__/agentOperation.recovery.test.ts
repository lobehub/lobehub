// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, tasks, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentOperationModel } from '../agentOperation';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-operation-recovery-user';
const otherUserId = 'agent-operation-recovery-other';
const topicId = 'agent-operation-recovery-topic';
const otherTopicId = 'agent-operation-recovery-topic-other';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values([
    { id: topicId, userId },
    { id: otherTopicId, userId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(agentOperations);
  await serverDB.delete(tasks);
  await serverDB.delete(topics);
  await serverDB.delete(users);
});

const model = (owner = userId) => new AgentOperationModel(serverDB, owner);

/** Start a run and park it, which is how a live operation reaches a wait state. */
const park = async (
  operationId: string,
  status: 'waiting_for_async_tool' | 'waiting_for_client' | 'waiting_for_human',
  options: { topicId?: string; owner?: string } = {},
) => {
  const owner = options.owner ?? userId;
  await model(owner).recordStart({ operationId, topicId: options.topicId ?? topicId });
  await model(owner).recordCompletion(operationId, { completionReason: status, status });
};

const setCreatedAt = async (operationId: string, at: string) => {
  await serverDB
    .update(agentOperations)
    .set({ createdAt: new Date(at) })
    .where(eq(agentOperations.id, operationId));
};

describe('AgentOperationModel recovery lookups', () => {
  describe('findLatestParkedOperationId', () => {
    it('resolves the newest human wait in the topic, ignoring other states, topics and owners', async () => {
      await park('park-old', 'waiting_for_human');
      await setCreatedAt('park-old', '2026-01-01T00:00:00Z');
      await park('park-new', 'waiting_for_human');
      await setCreatedAt('park-new', '2026-01-02T00:00:00Z');

      // Same topic, but the run is not parked on a person.
      await model().recordStart({ operationId: 'park-running', topicId });
      await setCreatedAt('park-running', '2026-01-03T00:00:00Z');

      // Another topic and another user both park on a person, but are not ours.
      await park('park-other-topic', 'waiting_for_human', { topicId: otherTopicId });
      await setCreatedAt('park-other-topic', '2026-01-04T00:00:00Z');
      await park('park-foreign', 'waiting_for_human', { owner: otherUserId });
      await setCreatedAt('park-foreign', '2026-01-05T00:00:00Z');

      expect(await model().findLatestParkedOperationId(topicId)).toBe('park-new');
      expect(await model().findLatestParkedOperationId('topic-with-nothing')).toBeUndefined();
    });
  });

  describe('findByIds', () => {
    it('batch-loads owned operations and short-circuits an empty request', async () => {
      await model().recordStart({ operationId: 'batch-a' });
      await model().recordStart({ operationId: 'batch-b' });
      await model(otherUserId).recordStart({ operationId: 'batch-foreign' });

      expect(await model().findByIds([])).toEqual([]);

      const rows = await model().findByIds([
        'batch-a',
        'batch-b',
        'batch-foreign',
        'batch-missing',
      ]);
      expect(rows.map((row) => row.id).sort()).toEqual(['batch-a', 'batch-b']);
    });
  });

  describe('recordCompletion model provenance', () => {
    it('stores the model and provider that produced the run', async () => {
      await model().recordStart({ operationId: 'op-provenance' });

      expect(
        await model().recordCompletion('op-provenance', {
          completionReason: 'done',
          model: 'gpt-5',
          provider: 'openai',
          status: 'done',
        }),
      ).toBe(true);
      expect(await model().findById('op-provenance')).toMatchObject({
        model: 'gpt-5',
        provider: 'openai',
      });
    });
  });

  describe('sumCostByTask', () => {
    it('sums the cost bound to a task, and reports zero when none is bound', async () => {
      await serverDB.insert(tasks).values({
        createdByUserId: userId,
        id: 'task-cost',
        identifier: 'T-COST',
        instruction: 'x',
        seq: 1,
      });

      await model().recordStart({ operationId: 'cost-a', taskId: 'task-cost' });
      await model().recordCompletion('cost-a', {
        completionReason: 'done',
        status: 'done',
        totalCost: 1.5,
      });
      await model().recordStart({ operationId: 'cost-b', taskId: 'task-cost' });
      await model().recordCompletion('cost-b', {
        completionReason: 'done',
        status: 'done',
        totalCost: 2.25,
      });
      await model().recordStart({ operationId: 'cost-unbound' });
      await model().recordCompletion('cost-unbound', {
        completionReason: 'done',
        status: 'done',
        totalCost: 99,
      });

      expect(await model().sumCostByTask('task-cost')).toBeCloseTo(3.75);
      // `sum()` over zero rows is NULL — the meter must read 0, not NaN.
      expect(await model().sumCostByTask('task-with-no-runs')).toBe(0);
      expect(await model(otherUserId).sumCostByTask('task-cost')).toBe(0);
    });
  });

  describe('findUsageByOperations', () => {
    it('deduplicates the requested ids and reports per-operation usage', async () => {
      await model().recordStart({ operationId: 'usage-a' });
      await model().recordCompletion('usage-a', {
        completionReason: 'done',
        status: 'done',
        totalCost: 0.5,
        totalTokens: 120,
      });
      // Never settled: both scalars stay NULL.
      await model().recordStart({ operationId: 'usage-null' });

      expect(await model().findUsageByOperations([])).toEqual(new Map());

      const usage = await model().findUsageByOperations([
        'usage-a',
        'usage-a',
        'usage-null',
        'usage-missing',
      ]);

      expect(usage.get('usage-a')).toEqual({ cost: 0.5, tokens: 120 });
      expect(usage.get('usage-null')).toEqual({ cost: 0, tokens: 0 });
      expect(usage.has('usage-missing')).toBe(false);
      expect(usage.size).toBe(2);
    });
  });

  describe('async tool resume claim', () => {
    it('resumes a parked async wait exactly once, within the owner', async () => {
      await park('op-async', 'waiting_for_async_tool');
      await park('op-async-foreign', 'waiting_for_async_tool');
      await park('op-human', 'waiting_for_human');

      const first = await model().tryResumeFromAsyncTool('op-async');
      expect(first).toBe(true);
      expect((await model().findById('op-async'))?.status).toBe('running');
      // Losing the race (or a second sub-op completing) must not resume twice.
      expect(await model().tryResumeFromAsyncTool('op-async')).toBe(false);
      // A person's wait is not an async tool wait.
      expect(await model().tryResumeFromAsyncTool('op-human')).toBe(false);
      // Owner isolation: another owner must not claim a genuinely resumable wait,
      // and the row has to stay parked for its real owner afterwards.
      expect(await model(otherUserId).tryResumeFromAsyncTool('op-async-foreign')).toBe(false);
      expect((await model().findById('op-async-foreign'))?.status).toBe('waiting_for_async_tool');
      expect(await model().tryResumeFromAsyncTool('op-never-started')).toBe(false);
    });
  });

  describe('settleClientWait', () => {
    it('retires a client wait with the default outcome', async () => {
      await park('wait-default', 'waiting_for_client');

      expect(await model().settleClientWait('wait-default')).toBe(true);
      expect(await model().findById('wait-default')).toMatchObject({
        completionReason: 'error',
        status: 'error',
      });
    });

    it('retires a client wait with the interrupted outcome when asked', async () => {
      await park('wait-interrupted', 'waiting_for_client');

      expect(await model().settleClientWait('wait-interrupted', 'interrupted')).toBe(true);
      expect(await model().findById('wait-interrupted')).toMatchObject({
        completionReason: 'interrupted',
        status: 'interrupted',
      });
    });

    it('never settles a run a client already resumed', async () => {
      await park('wait-resumed', 'waiting_for_client');
      expect(await model().tryResumeFromClientWait('wait-resumed')).toBe(true);

      expect(await model().settleClientWait('wait-resumed')).toBe(false);
      expect((await model().findById('wait-resumed'))?.status).toBe('running');
    });
  });

  describe('findLiveByTopic', () => {
    it('lists the resumable operations of a topic, independent of the UI marker', async () => {
      await model().recordStart({ operationId: 'live-running', topicId });
      await park('live-human', 'waiting_for_human');
      // A finished run is not resumable, so it stays out.
      await model().recordStart({ operationId: 'live-done', topicId });
      await model().settleRunning('live-done', 'done');
      // Other topics and other owners stay out as well.
      await model().recordStart({ operationId: 'live-other-topic', topicId: otherTopicId });
      await park('live-foreign', 'waiting_for_human', { owner: otherUserId });

      const rows = await model().findLiveByTopic(topicId);
      expect(rows.map((row) => row.id).sort()).toEqual(['live-human', 'live-running']);

      // The other owner's parked run is in the same topic, and only they see it.
      expect((await model(otherUserId).findLiveByTopic(topicId)).map((row) => row.id)).toEqual([
        'live-foreign',
      ]);
    });
  });

  describe('listWaitingForClient', () => {
    it('lists every parked wait when the caller names no providers', async () => {
      await park('wait-all-a', 'waiting_for_client');
      await park('wait-all-b', 'waiting_for_client');
      await serverDB
        .update(agentOperations)
        .set({ provider: 'ollama' })
        .where(eq(agentOperations.id, 'wait-all-b'));

      const rows = await model().listWaitingForClient();
      expect(rows.map((row) => row.id).sort()).toEqual(['wait-all-a', 'wait-all-b']);
    });
  });

  describe('settleRunning outcome', () => {
    it('stamps the interrupted reason when a live run is interrupted', async () => {
      await model().recordStart({ operationId: 'op-still-running' });

      expect(await model().settleRunning('op-still-running', 'interrupted')).toBe(true);
      expect(await model().findById('op-still-running')).toMatchObject({
        completionReason: 'interrupted',
        status: 'interrupted',
      });
    });
  });
});
