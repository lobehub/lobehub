// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardModel } from '@/database/models/dashboard';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { TrashModel } from '@/database/models/trash';
import { WidgetModel } from '@/database/models/widget';
import {
  agents,
  dashboards,
  messages,
  projectAgents,
  projects,
  topics,
  trashItems,
  users,
  widgets,
  workspaces,
} from '@/database/schemas';

import { TrashService } from '../index';

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({ deleteFiles: vi.fn() })),
}));

const db = await getTestDB();
const userId = 'trash-context-owner';
const memberId = 'trash-context-member';
const workspaceId = 'trash-context-ws';
const service = new TrashService(db, userId);
const registry = new TrashModel(db, userId);
const topicModel = new TopicModel(db, userId);
const messageModel = new MessageModel(db, userId);

const seedProject = async (id: string, ws: string | null = null) => {
  const [agent] = await db.insert(agents).values({ userId, workspaceId: ws }).returning();
  await db.insert(projects).values({
    coordinatorAgentId: agent.id,
    id,
    identifier: id === 'ctx-a' ? 'CTXA' : 'CTXB',
    name: id,
    userId,
    workspaceId: ws,
  });
  return agent;
};

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: memberId }]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(users);
});

describe('trash project context', () => {
  it.each(['ids', 'agent', 'session', 'group', 'all'] as const)(
    'records each topic project through the %s batch entry',
    async (entry) => {
      const agent = await seedProject('ctx-a');
      await seedProject('ctx-b');
      const seeded = await Promise.all(
        ['ctx-a', 'ctx-b', null].map((projectId) =>
          topicModel.create({ agentId: agent.id, projectId, title: 'topic' }),
        ),
      );
      const roots = await (entry === 'ids'
        ? service.trashTopics(seeded.map((t) => t.id))
        : entry === 'agent'
          ? service.trashTopicsByAgent(agent.id)
          : entry === 'session'
            ? service.trashTopicsBySession(null)
            : entry === 'group'
              ? service.trashTopicsByGroup(null)
              : service.trashAllTopics());
      expect(roots).toHaveLength(3);
      for (const topic of seeded) {
        expect(await registry.findByResource('topic', topic.id)).toMatchObject({
          projectId: topic.projectId,
          rootId: null,
        });
      }
    },
  );

  it('records messages and tool companions from their own topics, including topicless null', async () => {
    const agent = await seedProject('ctx-a');
    await seedProject('ctx-b');
    const a = await topicModel.create({ agentId: agent.id, projectId: 'ctx-a' });
    const b = await topicModel.create({ agentId: agent.id, projectId: 'ctx-b' });
    const plain = await topicModel.create({ agentId: agent.id });
    const assistant = await messageModel.create({
      agentId: agent.id,
      role: 'assistant',
      tools: [
        { apiName: 'search', arguments: '{}', id: 'ctx-call', identifier: 'web', type: 'default' },
      ],
      topicId: a.id,
    });
    const companion = await messageModel.create({
      agentId: agent.id,
      plugin: { apiName: 'search', arguments: '{}', identifier: 'web', type: 'default' },
      role: 'tool',
      tool_call_id: 'ctx-call',
      topicId: b.id,
    });
    const noProject = await messageModel.create({
      agentId: agent.id,
      role: 'user',
      topicId: plain.id,
    });
    const topicless = await messageModel.create({ agentId: agent.id, role: 'user' });
    await service.trashMessages([assistant.id, noProject.id, topicless.id]);
    const root = await registry.findByResource('message', assistant.id);
    expect(root?.projectId).toBe('ctx-a');
    expect(await registry.findByResource('message', companion.id)).toMatchObject({
      projectId: 'ctx-b',
      rootId: root!.id,
    });
    expect((await registry.findByResource('message', noProject.id))?.projectId).toBeNull();
    expect((await registry.findByResource('message', topicless.id))?.projectId).toBeNull();
    expect((await service.list()).items).toHaveLength(3);
  });

  it('keeps a coordinator agent root null and registers each cascade child independently', async () => {
    const agent = await seedProject('ctx-a');
    await seedProject('ctx-b');
    await db.insert(projectAgents).values([
      { projectId: 'ctx-a', agentId: agent.id },
      { projectId: 'ctx-b', agentId: agent.id },
    ]);
    const children = await Promise.all(
      ['ctx-a', 'ctx-b', null].map((projectId) =>
        topicModel.create({ agentId: agent.id, projectId }),
      ),
    );
    const topicless = await messageModel.create({ agentId: agent.id, role: 'user' });
    const root = await service.trashAgent(agent.id);
    expect(root?.projectId).toBeNull();
    expect(await registry.findChildren(root!.id)).toHaveLength(4);
    for (const topic of children) {
      expect(await registry.findByResource('topic', topic.id)).toMatchObject({
        projectId: topic.projectId,
        rootId: root!.id,
      });
    }
    expect(await registry.findByResource('message', topicless.id)).toMatchObject({
      projectId: null,
      rootId: root!.id,
    });
    expect((await service.list()).items.map((row) => row.resourceId)).toEqual([agent.id]);
    expect((await service.restore([root!.id])).failed).toEqual([]);
  });

  it('preserves first project and historical null on retry, then records the new project after restore', async () => {
    await seedProject('ctx-a');
    await seedProject('ctx-b');
    const topic = await topicModel.create({ projectId: 'ctx-a' });
    const [first] = await service.trashTopics([topic.id]);
    await db.update(topics).set({ projectId: 'ctx-b' }).where(eq(topics.id, topic.id));
    expect(await service.trashTopics([topic.id])).toEqual([]);
    expect(await registry.findById(first.id)).toMatchObject({ projectId: 'ctx-a' });
    await db.update(trashItems).set({ projectId: null }).where(eq(trashItems.id, first.id));
    await service.trashTopics([topic.id]);
    expect((await registry.findById(first.id))?.projectId).toBeNull();
    await service.restore([first.id]);
    const [fresh] = await service.trashTopics([topic.id]);
    expect(fresh.id).not.toBe(first.id);
    expect(fresh.projectId).toBe('ctx-b');
    await db.delete(projects).where(eq(projects.id, 'ctx-b'));
    expect((await registry.findById(fresh.id))?.projectId).toBe('ctx-b');
    expect((await db.select().from(topics).where(eq(topics.id, topic.id)))[0].projectId).toBeNull();
    expect((await service.restore([fresh.id])).failed).toEqual([]);
    const [last] = await service.trashTopics([topic.id]);
    expect(last.projectId).toBeNull();
    expect(await service.purge([last.id])).toEqual({ purged: 1 });
  });

  it('rolls back both source stamps and project registration when a batch insert fails', async () => {
    await seedProject('ctx-a');
    const topic = await topicModel.create({ projectId: 'ctx-a' });
    await db.execute(
      sql`ALTER TABLE trash_items ADD CONSTRAINT reject_ctx_project CHECK (project_id IS NULL)`,
    );
    try {
      await expect(service.trashTopics([topic.id])).rejects.toThrow();
      expect(await topicModel.findById(topic.id)).toMatchObject({ deletedAt: null });
      expect(await registry.findByResource('topic', topic.id)).toBeUndefined();
    } finally {
      await db.execute(sql`ALTER TABLE trash_items DROP CONSTRAINT reject_ctx_project`);
    }
  });

  it.each(['message', 'agent'] as const)(
    'rolls back %s and its cascade if project registration fails',
    async (kind) => {
      const agent = await seedProject('ctx-a');
      const topic = await topicModel.create({ agentId: agent.id, projectId: 'ctx-a' });
      const message = await messageModel.create({
        agentId: agent.id,
        role: 'user',
        topicId: topic.id,
      });
      await db.execute(
        sql`ALTER TABLE trash_items ADD CONSTRAINT reject_ctx_project CHECK (project_id IS NULL)`,
      );
      try {
        await expect(
          kind === 'agent' ? service.trashAgent(agent.id) : service.trashMessages([message.id]),
        ).rejects.toThrow();
        expect(await topicModel.findById(topic.id)).toBeDefined();
        const [sourceAgent] = await db.select().from(agents).where(eq(agents.id, agent.id));
        expect(sourceAgent.isDeleted).not.toBe(true);
        const [source] = await db.select().from(messages).where(eq(messages.id, message.id));
        expect(source.isDeleted).not.toBe(true);
        expect(await db.select().from(trashItems)).toEqual([]);
      } finally {
        await db.execute(sql`ALTER TABLE trash_items DROP CONSTRAINT reject_ctx_project`);
      }
    },
  );

  it.each(['widget', 'dashboard'] as const)(
    'keeps %s creator permissions in workspace mode',
    async (kind) => {
      await db
        .insert(workspaces)
        .values({ id: workspaceId, name: 'context', primaryOwnerId: userId, slug: workspaceId });
      await seedProject('ctx-a', workspaceId);
      const member =
        kind === 'widget'
          ? new WidgetModel(db, memberId, workspaceId)
          : new DashboardModel(db, memberId, workspaceId);
      const owner =
        kind === 'widget'
          ? new WidgetModel(db, userId, workspaceId)
          : new DashboardModel(db, userId, workspaceId);
      const source = await member.create({ projectId: 'ctx-a', title: kind });
      expect(await owner.trash(source.id)).toBeUndefined();
      expect(
        await new TrashModel(db, userId, workspaceId).findByResource(kind, source.id),
      ).toBeUndefined();
      await member.trash(source.id);
      expect(
        await new TrashModel(db, userId, workspaceId).findByResource(kind, source.id),
      ).toMatchObject({
        projectId: 'ctx-a',
        userId: memberId,
        deletedByUserId: memberId,
        workspaceId,
      });
      expect(await registry.findByResource(kind, source.id)).toBeUndefined();
    },
  );

  it('retains personal/workspace and owner/member actor boundaries for projects', async () => {
    await db
      .insert(workspaces)
      .values({ id: workspaceId, name: 'context', primaryOwnerId: userId, slug: workspaceId });
    await seedProject('ctx-a', workspaceId);
    const memberTopics = new TopicModel(db, memberId, workspaceId);
    const wsOwner = new TrashService(db, userId, workspaceId);
    const wsMember = new TrashService(db, memberId, workspaceId);
    const own = await memberTopics.create({ projectId: 'ctx-a' });
    const foreign = await new TopicModel(db, userId, workspaceId).create({ projectId: 'ctx-a' });
    expect(await service.trashTopics([own.id])).toEqual([]);
    const roots = await wsMember.trashTopics([own.id, foreign.id], { restrictToCreator: true });
    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({ deletedByUserId: memberId, projectId: 'ctx-a', workspaceId });
    expect((await wsOwner.trashTopics([foreign.id]))[0]).toMatchObject({
      deletedByUserId: userId,
      projectId: 'ctx-a',
    });
    expect((await service.list()).items).toEqual([]);
    expect(
      (await wsMember.list({ deletedByUserId: memberId })).items.map((row) => row.resourceId),
    ).toEqual([own.id]);
    expect(await new TrashService(db, memberId).trashMessages(['missing'])).toEqual([]);
  });

  it.each(['widget', 'dashboard'] as const)(
    'records %s context atomically without changing its restore/purge unit',
    async (kind) => {
      await seedProject('ctx-a');
      await seedProject('ctx-b');
      const model =
        kind === 'widget' ? new WidgetModel(db, userId) : new DashboardModel(db, userId);
      const source = await model.create({ projectId: 'ctx-a', title: kind });
      await model.trash(source.id);
      const first = await registry.findByResource(kind, source.id);
      expect(first?.projectId).toBe('ctx-a');
      const table = kind === 'widget' ? widgets : dashboards;
      await db.update(table).set({ projectId: 'ctx-b' }).where(eq(table.id, source.id));
      await model.trash(source.id);
      expect((await registry.findByResource(kind, source.id))?.projectId).toBe('ctx-a');
      expect((await service.restore([first!.id])).failed).toEqual([]);
      await model.trash(source.id);
      const fresh = await registry.findByResource(kind, source.id);
      expect(fresh?.projectId).toBe('ctx-b');
      expect(await service.purge([fresh!.id])).toEqual({ purged: 1 });
      const next = await model.create({ projectId: 'ctx-b', title: kind });
      await db.execute(
        sql`ALTER TABLE trash_items ADD CONSTRAINT reject_ctx_project CHECK (project_id IS NULL)`,
      );
      try {
        await expect(model.trash(next.id)).rejects.toThrow();
        expect(await model.findById(next.id)).toBeDefined();
        expect(await registry.findByResource(kind, next.id)).toBeUndefined();
      } finally {
        await db.execute(sql`ALTER TABLE trash_items DROP CONSTRAINT reject_ctx_project`);
      }
      const lost = await model.create({ projectId: 'ctx-a', title: 'project deleted' });
      await model.trash(lost.id);
      await db.delete(projects).where(eq(projects.id, 'ctx-a'));
      expect((await registry.findByResource(kind, lost.id))?.projectId).toBe('ctx-a');
      const unscoped = await model.create({ title: 'no project' });
      await model.trash(unscoped.id);
      expect((await registry.findByResource(kind, unscoped.id))?.projectId).toBeNull();
    },
  );
});
