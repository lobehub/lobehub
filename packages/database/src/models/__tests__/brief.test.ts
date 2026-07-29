// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentCronJobs, agents, briefs, tasks, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { BriefModel } from '../brief';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'brief-test-user-id';
const userId2 = 'brief-test-user-id-2';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('BriefModel', () => {
  describe('create', () => {
    it('should create a brief', async () => {
      const model = new BriefModel(serverDB, userId);
      const brief = await model.create({
        summary: 'Outline is ready for review',
        title: 'Outline completed',
        type: 'decision',
      });

      expect(brief).toBeDefined();
      expect(brief.id).toBeDefined();
      expect(brief.userId).toBe(userId);
      expect(brief.type).toBe('decision');
      expect(brief.priority).toBe('info');
      expect(brief.readAt).toBeNull();
      expect(brief.resolvedAt).toBeNull();
    });

    it('should create a brief with all fields', async () => {
      const model = new BriefModel(serverDB, userId);
      const brief = await model.create({
        actions: [{ label: 'Approve', type: 'approve' }],
        agentId: 'agent-1',
        artifacts: {
          documents: [
            { id: 'doc-1', kind: null, title: null },
            { id: 'doc-2', kind: null, title: null },
          ],
        },
        priority: 'urgent',
        summary: 'Chapter too long, suggest splitting',
        taskId: null,
        title: 'Chapter 4 needs split',
        topicId: 'topic-1',
        type: 'decision',
      });

      expect(brief.priority).toBe('urgent');
      expect(brief.agentId).toBe('agent-1');
      expect(brief.actions).toEqual([{ label: 'Approve', type: 'approve' }]);
      expect(brief.artifacts).toEqual({
        documents: [
          { id: 'doc-1', kind: null, title: null },
          { id: 'doc-2', kind: null, title: null },
        ],
      });
    });
  });

  describe('findById', () => {
    it('should find brief by id', async () => {
      const model = new BriefModel(serverDB, userId);
      const created = await model.create({
        summary: 'Test',
        title: 'Test brief',
        type: 'result',
      });

      const found = await model.findById(created.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
    });

    it('should not find brief owned by another user', async () => {
      const model1 = new BriefModel(serverDB, userId);
      const model2 = new BriefModel(serverDB, userId2);

      const brief = await model1.create({
        summary: 'Test',
        title: 'Test',
        type: 'result',
      });

      const found = await model2.findById(brief.id);
      expect(found).toBeNull();
    });
  });

  describe('list', () => {
    it('should list briefs for user', async () => {
      const model = new BriefModel(serverDB, userId);
      await model.create({ summary: 'A', title: 'Brief 1', type: 'result' });
      await model.create({ summary: 'B', title: 'Brief 2', type: 'decision' });

      const { briefs, total } = await model.list();
      expect(total).toBe(2);
      expect(briefs).toHaveLength(2);
    });

    it('should filter by type', async () => {
      const model = new BriefModel(serverDB, userId);
      await model.create({ summary: 'A', title: 'Brief 1', type: 'result' });
      await model.create({ summary: 'B', title: 'Brief 2', type: 'decision' });

      const { briefs } = await model.list({ type: 'decision' });
      expect(briefs).toHaveLength(1);
      expect(briefs[0].type).toBe('decision');
    });

    it('should not leak briefs across users in workspace mode', async () => {
      const wsId = 'brief-leak-ws';
      await serverDB
        .insert(workspaces)
        .values({
          id: wsId,
          name: 'Brief Leak WS',
          primaryOwnerId: userId,
          slug: 'brief-leak-ws',
        })
        .onConflictDoNothing();

      const alice = new BriefModel(serverDB, userId, wsId);
      const bob = new BriefModel(serverDB, userId2, wsId);

      await alice.create({ summary: 'Alice secret', title: 'Alice brief', type: 'result' });
      await bob.create({ summary: 'Bob secret', title: 'Bob brief', type: 'result' });

      const aliceList = await alice.list();
      expect(aliceList.total).toBe(1);
      expect(aliceList.briefs[0].title).toBe('Alice brief');

      const bobList = await bob.list();
      expect(bobList.total).toBe(1);
      expect(bobList.briefs[0].title).toBe('Bob brief');
    });

    it('should not leak briefs to other workspace members via findById', async () => {
      const wsId = 'brief-leak-findbyid-ws';
      await serverDB
        .insert(workspaces)
        .values({
          id: wsId,
          name: 'Brief Leak FindById WS',
          primaryOwnerId: userId,
          slug: 'brief-leak-findbyid-ws',
        })
        .onConflictDoNothing();

      const alice = new BriefModel(serverDB, userId, wsId);
      const bob = new BriefModel(serverDB, userId2, wsId);

      const aliceBrief = await alice.create({
        summary: 'Alice secret',
        title: 'Alice brief',
        type: 'result',
      });

      expect(await alice.findById(aliceBrief.id)).not.toBeNull();
      expect(await bob.findById(aliceBrief.id)).toBeNull();
    });
  });

  describe('listUnresolvedEnriched', () => {
    it('should return unresolved briefs sorted by priority and exclude resolved ones', async () => {
      const model = new BriefModel(serverDB, userId);
      const b1 = await model.create({
        priority: 'info',
        summary: 'Low',
        title: 'Info',
        type: 'result',
      });
      await model.create({
        priority: 'urgent',
        summary: 'High',
        title: 'Urgent',
        type: 'decision',
      });
      await model.create({
        priority: 'normal',
        summary: 'Mid',
        title: 'Normal',
        type: 'insight',
      });
      await model.resolve(b1.id);

      const rows = await model.listUnresolvedEnriched();
      expect(rows).toHaveLength(2);
      expect(rows[0].brief.priority).toBe('urgent');
      expect(rows[1].brief.priority).toBe('normal');
    });

    it('should join the producing agent and parent task status in one query', async () => {
      await serverDB.insert(agents).values({
        avatar: '🤖',
        backgroundColor: '#fff',
        id: 'agent-x',
        title: 'Agent X',
        userId,
      });
      await serverDB.insert(tasks).values({
        createdByUserId: userId,
        id: 'task-x',
        identifier: 'TASK-X',
        instruction: 'do work',
        name: 'Task X',
        seq: 1,
        status: 'paused',
      });

      const model = new BriefModel(serverDB, userId);
      await model.create({
        agentId: 'agent-x',
        priority: 'urgent',
        summary: 'Has agent + task',
        taskId: 'task-x',
        title: 'Joined',
        type: 'decision',
      });
      await model.create({
        priority: 'info',
        summary: 'Bare brief',
        title: 'No agent',
        type: 'insight',
      });

      const rows = await model.listUnresolvedEnriched();
      expect(rows).toHaveLength(2);

      const joined = rows.find((r) => r.brief.title === 'Joined')!;
      expect(joined.agentRowId).toBe('agent-x');
      expect(joined.agentAvatar).toBe('🤖');
      expect(joined.agentTitle).toBe('Agent X');
      expect(joined.taskStatus).toBe('paused');

      const bare = rows.find((r) => r.brief.title === 'No agent')!;
      expect(bare.agentRowId).toBeNull();
      expect(bare.taskStatus).toBeNull();
    });

    it('should still return briefs whose producing agent has been deleted', async () => {
      const model = new BriefModel(serverDB, userId);
      // agentId points at a row that doesn't exist — LEFT JOIN should keep
      // the brief and surface null agent fields rather than dropping it.
      await model.create({
        agentId: 'agent-ghost',
        summary: 'Producer gone',
        title: 'Ghost',
        type: 'result',
      });

      const rows = await model.listUnresolvedEnriched();
      expect(rows).toHaveLength(1);
      expect(rows[0].brief.title).toBe('Ghost');
      expect(rows[0].agentRowId).toBeNull();
      expect(rows[0].agentAvatar).toBeNull();
    });

    it('should respect the default cap of 20 and a caller-provided limit', async () => {
      const model = new BriefModel(serverDB, userId);
      for (let i = 0; i < 25; i++) {
        await model.create({ summary: `S${i}`, title: `Brief ${i}`, type: 'insight' });
      }

      const capped = await model.listUnresolvedEnriched();
      expect(capped).toHaveLength(20);

      const trimmed = await model.listUnresolvedEnriched({ limit: 3 });
      expect(trimmed).toHaveLength(3);
    });
  });

  describe('listUnresolvedByAgentAndTrigger', () => {
    /**
     * @example
     * listUnresolvedByAgentAndTrigger({ agentId, trigger }) returns matching older briefs even when unrelated briefs exceed the cap.
     */
    it('should filter by user, unresolved status, trigger, and agent before applying the limit', async () => {
      const model = new BriefModel(serverDB, userId);

      for (let i = 0; i < 25; i++) {
        await model.create({
          agentId: 'other-agent',
          priority: 'urgent',
          summary: `Unrelated ${i}`,
          title: `Unrelated ${i}`,
          trigger: 'other-trigger',
          type: 'decision',
        });
      }

      await model.create({
        agentId: 'agent-1',
        priority: 'normal',
        summary: 'Matching proposal',
        title: 'Matching',
        trigger: 'agent-signal:nightly-review',
        type: 'decision',
      });

      const rows = await model.listUnresolvedByAgentAndTrigger({
        agentId: 'agent-1',
        limit: 20,
        trigger: 'agent-signal:nightly-review',
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].summary).toBe('Matching proposal');
    });

    it('should exclude resolved briefs and respect the default limit', async () => {
      const model = new BriefModel(serverDB, userId);

      const resolved = await model.create({
        agentId: 'agent-1',
        summary: 'Resolved match',
        title: 'Resolved',
        trigger: 'agent-signal:nightly-review',
        type: 'decision',
      });
      await model.resolve(resolved.id);

      await model.create({
        agentId: 'agent-1',
        summary: 'Open match',
        title: 'Open',
        trigger: 'agent-signal:nightly-review',
        type: 'decision',
      });

      const rows = await model.listUnresolvedByAgentAndTrigger({
        agentId: 'agent-1',
        trigger: 'agent-signal:nightly-review',
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].summary).toBe('Open match');
    });
  });

  describe('findByTaskId', () => {
    it('should return briefs for a task ordered newest first', async () => {
      await serverDB.insert(tasks).values({
        createdByUserId: userId,
        id: 'task-find',
        identifier: 'TASK-FIND',
        instruction: 'do work',
        name: 'Task Find',
        seq: 1,
        status: 'running',
      });

      const model = new BriefModel(serverDB, userId);
      const first = await model.create({
        summary: 'First',
        taskId: 'task-find',
        title: 'First',
        type: 'result',
      });
      const second = await model.create({
        summary: 'Second',
        taskId: 'task-find',
        title: 'Second',
        type: 'result',
      });
      // unrelated brief without the task
      await model.create({ summary: 'Other', title: 'Other', type: 'result' });

      // Explicit, separated createdAt so `desc(createdAt)` ordering is deterministic
      // (the model has no id tiebreaker; back-to-back creates can tie within a ms).
      await serverDB
        .update(briefs)
        .set({ createdAt: new Date('2025-01-01T00:00:00Z') })
        .where(eq(briefs.id, first.id));
      await serverDB
        .update(briefs)
        .set({ createdAt: new Date('2025-01-02T00:00:00Z') })
        .where(eq(briefs.id, second.id));

      const rows = await model.findByTaskId('task-find');
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.id)).toEqual([second.id, first.id]);
    });

    it('should not return briefs owned by another user for the same task', async () => {
      await serverDB.insert(tasks).values({
        createdByUserId: userId,
        id: 'task-shared',
        identifier: 'TASK-SHARED',
        instruction: 'do work',
        name: 'Task Shared',
        seq: 2,
        status: 'running',
      });

      const model1 = new BriefModel(serverDB, userId);
      await model1.create({
        summary: 'Owned by 1',
        taskId: 'task-shared',
        title: 'Owned',
        type: 'result',
      });

      const model2 = new BriefModel(serverDB, userId2);
      const rows = await model2.findByTaskId('task-shared');
      expect(rows).toHaveLength(0);
    });
  });

  describe('hasUnresolvedUrgentByTask', () => {
    it('should return true when an unresolved urgent brief exists for the task', async () => {
      await serverDB.insert(tasks).values({
        createdByUserId: userId,
        id: 'task-urgent',
        identifier: 'TASK-URGENT',
        instruction: 'do work',
        name: 'Task Urgent',
        seq: 1,
        status: 'running',
      });

      const model = new BriefModel(serverDB, userId);
      await model.create({
        priority: 'urgent',
        summary: 'Needs review',
        taskId: 'task-urgent',
        title: 'Urgent',
        type: 'decision',
      });

      expect(await model.hasUnresolvedUrgentByTask('task-urgent')).toBe(true);
    });

    it('should return false when the only urgent brief is resolved', async () => {
      await serverDB.insert(tasks).values({
        createdByUserId: userId,
        id: 'task-resolved',
        identifier: 'TASK-RESOLVED',
        instruction: 'do work',
        name: 'Task Resolved',
        seq: 2,
        status: 'running',
      });

      const model = new BriefModel(serverDB, userId);
      const brief = await model.create({
        priority: 'urgent',
        summary: 'Resolved urgent',
        taskId: 'task-resolved',
        title: 'Resolved',
        type: 'decision',
      });
      await model.resolve(brief.id);

      expect(await model.hasUnresolvedUrgentByTask('task-resolved')).toBe(false);
    });

    it('should return false when the urgent brief type is excluded', async () => {
      await serverDB.insert(tasks).values({
        createdByUserId: userId,
        id: 'task-excluded',
        identifier: 'TASK-EXCLUDED',
        instruction: 'do work',
        name: 'Task Excluded',
        seq: 3,
        status: 'running',
      });

      const model = new BriefModel(serverDB, userId);
      await model.create({
        priority: 'urgent',
        summary: 'Transient error',
        taskId: 'task-excluded',
        title: 'Error',
        type: 'error',
      });

      expect(
        await model.hasUnresolvedUrgentByTask('task-excluded', { excludeTypes: ['error'] }),
      ).toBe(false);
      // a non-excluded urgent brief still flips it back to true
      await model.create({
        priority: 'urgent',
        summary: 'Decision needed',
        taskId: 'task-excluded',
        title: 'Decision',
        type: 'decision',
      });
      expect(
        await model.hasUnresolvedUrgentByTask('task-excluded', { excludeTypes: ['error'] }),
      ).toBe(true);
    });

    it('should return false when there are no matching briefs', async () => {
      const model = new BriefModel(serverDB, userId);
      expect(await model.hasUnresolvedUrgentByTask('nonexistent-task')).toBe(false);
    });
  });

  describe('findByCronJobId', () => {
    it('should return briefs for a cron job ordered newest first', async () => {
      await serverDB.insert(agents).values({ id: 'agent-cron', title: 'Cron Agent', userId });
      await serverDB.insert(agentCronJobs).values({
        agentId: 'agent-cron',
        content: 'do it',
        cronPattern: '*/30 * * * *',
        id: 'cron-1',
        userId,
      });

      const model = new BriefModel(serverDB, userId);
      const first = await model.create({
        cronJobId: 'cron-1',
        summary: 'First',
        title: 'First',
        type: 'result',
      });
      const second = await model.create({
        cronJobId: 'cron-1',
        summary: 'Second',
        title: 'Second',
        type: 'result',
      });
      await model.create({ summary: 'No cron', title: 'No cron', type: 'result' });

      // Explicit, separated createdAt so `desc(createdAt)` ordering is deterministic.
      await serverDB
        .update(briefs)
        .set({ createdAt: new Date('2025-01-01T00:00:00Z') })
        .where(eq(briefs.id, first.id));
      await serverDB
        .update(briefs)
        .set({ createdAt: new Date('2025-01-02T00:00:00Z') })
        .where(eq(briefs.id, second.id));

      const rows = await model.findByCronJobId('cron-1');
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.id)).toEqual([second.id, first.id]);
    });

    it('should return empty when no briefs match the cron job', async () => {
      const model = new BriefModel(serverDB, userId);
      const rows = await model.findByCronJobId('missing-cron');
      expect(rows).toHaveLength(0);
    });
  });

  describe('updateMetadata', () => {
    it('should persist metadata without resolving the brief', async () => {
      const model = new BriefModel(serverDB, userId);
      const brief = await model.create({ summary: 'A', title: 'Test', type: 'decision' });

      const updated = await model.updateMetadata(brief.id, { proposalState: 'stale' } as any);
      expect(updated).not.toBeNull();
      expect(updated!.metadata).toEqual({ proposalState: 'stale' });
      expect(updated!.resolvedAt).toBeNull();
    });

    it('should return null when the brief does not exist', async () => {
      const model = new BriefModel(serverDB, userId);
      const updated = await model.updateMetadata('missing-id', { foo: 'bar' } as any);
      expect(updated).toBeNull();
    });

    it('should not update a brief owned by another user', async () => {
      const model1 = new BriefModel(serverDB, userId);
      const brief = await model1.create({ summary: 'A', title: 'Test', type: 'decision' });

      const model2 = new BriefModel(serverDB, userId2);
      const updated = await model2.updateMetadata(brief.id, { foo: 'bar' } as any);
      expect(updated).toBeNull();
    });
  });

  describe('markRead', () => {
    it('should mark brief as read', async () => {
      const model = new BriefModel(serverDB, userId);
      const brief = await model.create({ summary: 'A', title: 'Test', type: 'result' });

      const updated = await model.markRead(brief.id);
      expect(updated!.readAt).toBeDefined();
      expect(updated!.resolvedAt).toBeNull();
    });
  });

  describe('resolve', () => {
    it('should mark brief as resolved and read', async () => {
      const model = new BriefModel(serverDB, userId);
      const brief = await model.create({ summary: 'A', title: 'Test', type: 'decision' });

      const updated = await model.resolve(brief.id);
      expect(updated!.readAt).toBeDefined();
      expect(updated!.resolvedAt).toBeDefined();
    });
  });

  describe('resolveManyAsRead', () => {
    it('should resolve the given briefs with the read action and return their ids', async () => {
      const model = new BriefModel(serverDB, userId);
      const a = await model.create({ summary: 'A', title: 'Report A', type: 'result' });
      const b = await model.create({ summary: 'B', title: 'Report B', type: 'insight' });

      const resolvedIds = await model.resolveManyAsRead([a.id, b.id]);
      expect(resolvedIds.sort()).toEqual([a.id, b.id].sort());

      for (const id of [a.id, b.id]) {
        const found = await model.findById(id);
        expect(found!.resolvedAt).not.toBeNull();
        expect(found!.readAt).not.toBeNull();
        expect(found!.resolvedAction).toBe('read');
      }
    });

    it('should skip already-resolved briefs and keep their original action', async () => {
      const model = new BriefModel(serverDB, userId);
      const approved = await model.create({ summary: 'A', title: 'Delivery', type: 'result' });
      await model.resolve(approved.id, { action: 'approve' });
      const fresh = await model.create({ summary: 'B', title: 'Report', type: 'result' });

      const resolvedIds = await model.resolveManyAsRead([approved.id, fresh.id]);
      expect(resolvedIds).toEqual([fresh.id]);

      const kept = await model.findById(approved.id);
      expect(kept!.resolvedAction).toBe('approve');
    });

    it('should preserve the first-read timestamp of an already-read brief', async () => {
      const model = new BriefModel(serverDB, userId);
      const brief = await model.create({ summary: 'A', title: 'Report', type: 'result' });
      const read = await model.markRead(brief.id);

      await model.resolveManyAsRead([brief.id]);

      const found = await model.findById(brief.id);
      expect(found!.readAt).toEqual(read!.readAt);
      expect(found!.resolvedAt).not.toBeNull();
    });

    it('should not resolve briefs owned by another user', async () => {
      const otherModel = new BriefModel(serverDB, userId2);
      const foreign = await otherModel.create({ summary: 'X', title: 'Foreign', type: 'result' });

      const model = new BriefModel(serverDB, userId);
      const resolvedIds = await model.resolveManyAsRead([foreign.id]);
      expect(resolvedIds).toEqual([]);

      const untouched = await otherModel.findById(foreign.id);
      expect(untouched!.resolvedAt).toBeNull();
    });

    it('should return empty for an empty id list', async () => {
      const model = new BriefModel(serverDB, userId);
      await expect(model.resolveManyAsRead([])).resolves.toEqual([]);
    });
  });

  describe('delete', () => {
    it('should delete brief', async () => {
      const model = new BriefModel(serverDB, userId);
      const brief = await model.create({ summary: 'A', title: 'Test', type: 'result' });

      const deleted = await model.delete(brief.id);
      expect(deleted).toBe(true);

      const found = await model.findById(brief.id);
      expect(found).toBeNull();
    });
  });
});
