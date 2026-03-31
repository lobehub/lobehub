// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
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
        artifacts: ['doc-1', 'doc-2'],
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
      expect(brief.artifacts).toEqual(['doc-1', 'doc-2']);
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

  describe('listUnresolved', () => {
    it('should return unresolved briefs sorted by priority', async () => {
      const model = new BriefModel(serverDB, userId);
      await model.create({ priority: 'info', summary: 'Low', title: 'Info', type: 'result' });
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

      const unresolved = await model.listUnresolved();
      expect(unresolved).toHaveLength(3);
      expect(unresolved[0].priority).toBe('urgent');
      expect(unresolved[1].priority).toBe('normal');
      expect(unresolved[2].priority).toBe('info');
    });

    it('should exclude resolved briefs', async () => {
      const model = new BriefModel(serverDB, userId);
      const b1 = await model.create({ summary: 'A', title: 'Brief 1', type: 'result' });
      await model.create({ summary: 'B', title: 'Brief 2', type: 'result' });

      await model.resolve(b1.id);

      const unresolved = await model.listUnresolved();
      expect(unresolved).toHaveLength(1);
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
