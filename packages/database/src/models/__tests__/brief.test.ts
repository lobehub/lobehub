// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, tasks, users } from '../../schemas';
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
