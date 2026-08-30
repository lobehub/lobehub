// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { SessionModel } from '@/database/models/session';
import { TopicModel } from '@/database/models/topic';
import { TrashModel } from '@/database/models/trash';
import { HomeRepository } from '@/database/repositories/home';
import {
  agents,
  messages,
  sessions,
  topics,
  trashItems,
  users,
  workspaces,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { TrashService } from '../index';

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({ deleteFile: vi.fn(), deleteFiles: vi.fn() })),
}));

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'trash-service-user';
const otherUserId = 'trash-service-other';

let service: TrashService;
let topicModel: TopicModel;
let agentModel: AgentModel;
let sessionModel: SessionModel;
let messageModel: MessageModel;
let trashModel: TrashModel;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  service = new TrashService(serverDB, userId);
  topicModel = new TopicModel(serverDB, userId);
  agentModel = new AgentModel(serverDB, userId);
  sessionModel = new SessionModel(serverDB, userId);
  messageModel = new MessageModel(serverDB, userId);
  trashModel = new TrashModel(serverDB, userId);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('TrashService', () => {
  describe('topics', () => {
    it('hides a trashed topic from reads, lists it in the bin, restores it with its messages intact', async () => {
      const agent = await agentModel.create({ title: 'Bot' });
      const topic = await topicModel.create({ agentId: agent.id, title: 'Plan the trip' });
      await messageModel.create({
        agentId: agent.id,
        content: 'hi',
        role: 'user',
        topicId: topic.id,
      });

      const [root] = await service.trashTopics([topic.id]);
      expect(root.resourceType).toBe('topic');
      expect(root.title).toBe('Plan the trip');

      // invisible to every ordinary read …
      expect(await topicModel.findById(topic.id)).toBeUndefined();
      expect((await topicModel.query({ agentId: agent.id })).items).toHaveLength(0);
      // … but the rows are still there
      expect(
        await serverDB.select().from(messages).where(eq(messages.topicId, topic.id)),
      ).toHaveLength(1);

      const { items } = await service.list();
      expect(items.map((i) => i.resourceId)).toEqual([topic.id]);
      expect(await service.countByType()).toEqual({ topic: 1 });

      const outcome = await service.restore([root.id]);
      expect(outcome.restored.map((i) => i.resourceId)).toEqual([topic.id]);
      expect(outcome.failed).toEqual([]);
      expect(await topicModel.findById(topic.id)).toMatchObject({ deletedAt: null, id: topic.id });
      expect(await serverDB.select().from(trashItems)).toHaveLength(0);
    });

    it('bulk sweeps become one restorable root per topic', async () => {
      const agent = await agentModel.create({ title: 'Bot' });
      await topicModel.create({ agentId: agent.id, title: 'a' });
      await topicModel.create({ agentId: agent.id, title: 'b' });
      const roots = await service.trashTopicsByAgent(agent.id);
      expect(roots).toHaveLength(2);
      expect((await topicModel.query({ agentId: agent.id })).items).toHaveLength(0);
      expect((await service.list()).items).toHaveLength(2);
    });
  });

  describe('agents', () => {
    it('cascades to topics (incl. legacy session-scoped ones), hides the session shell, and restores the whole unit', async () => {
      const session = await sessionModel.create({ config: { title: 'Legacy' }, type: 'agent' });
      const agent = (await sessionModel.findByIdOrSlug(session.id))!.agent;
      const t1 = await topicModel.create({ agentId: agent.id, title: 'via agent' });
      const t2 = await topicModel.create({ sessionId: session.id, title: 'via session' });
      // trashed earlier on its own — must survive the agent restore as its own root
      const [olderRoot] = await service.trashTopics([t2.id]);

      const root = await service.trashAgent(agent.id);
      expect(root?.meta?.childCount).toBe(1);

      expect(await agentModel.existsById(agent.id)).toBe(false);
      // The legacy session shell is not stamped itself but drops out of the
      // legacy list through the agent join.
      expect((await sessionModel.query()).map((s) => s.id)).not.toContain(session.id);
      expect(await topicModel.findById(t1.id)).toBeUndefined();
      expect(await topicModel.findById(t2.id)).toBeUndefined();
      const home = await new HomeRepository(serverDB, userId).getSidebarAgentList();
      expect(JSON.stringify(home)).not.toContain(agent.id);

      const listed = (await service.list()).items.map((i) => i.resourceId);
      expect(listed).toEqual([agent.id, t2.id]);

      await service.restore([root!.id]);
      expect(await agentModel.existsById(agent.id)).toBe(true);
      expect((await sessionModel.query()).map((s) => s.id)).toContain(session.id);
      expect(await topicModel.findById(t1.id)).toBeTruthy();
      // t2 was trashed before the agent — still in the bin
      expect(await topicModel.findById(t2.id)).toBeUndefined();
      expect((await service.list()).items.map((i) => i.id)).toEqual([olderRoot.id]);
    });

    it('refuses to restore a topic whose agent is still in the bin', async () => {
      const agent = await agentModel.create({ title: 'Bot' });
      const topic = await topicModel.create({ agentId: agent.id, title: 't' });
      const [topicRoot] = await service.trashTopics([topic.id]);
      await service.trashAgent(agent.id);

      const outcome = await service.restore([topicRoot.id]);
      expect(outcome.failed).toEqual([{ code: 'parentTrashed', id: topicRoot.id }]);
      expect(await topicModel.findById(topic.id)).toBeUndefined();
    });

    it('purges the agent with its cascade', async () => {
      const session = await sessionModel.create({ config: { title: 'Legacy' }, type: 'agent' });
      const agent = (await sessionModel.findByIdOrSlug(session.id))!.agent;
      const topic = await topicModel.create({ agentId: agent.id, title: 't' });
      await messageModel.create({
        agentId: agent.id,
        content: 'hi',
        role: 'user',
        topicId: topic.id,
      });

      const root = await service.trashAgent(agent.id);
      await service.purge([root!.id]);

      expect(await serverDB.select().from(agents).where(eq(agents.id, agent.id))).toHaveLength(0);
      expect(
        await serverDB.select().from(sessions).where(eq(sessions.id, session.id)),
      ).toHaveLength(0);
      expect(await serverDB.select().from(topics).where(eq(topics.id, topic.id))).toHaveLength(0);
      expect(await serverDB.select().from(trashItems)).toHaveLength(0);
    });
  });

  describe('messages', () => {
    const seedChain = async () => {
      const agent = await agentModel.create({ title: 'Bot' });
      const topic = await topicModel.create({ agentId: agent.id, title: 't' });
      const u1 = await messageModel.create({
        agentId: agent.id,
        content: 'q1',
        role: 'user',
        topicId: topic.id,
      });
      const a1 = await messageModel.create({
        agentId: agent.id,
        content: 'a1',
        parentId: u1.id,
        role: 'assistant',
        topicId: topic.id,
      });
      const u2 = await messageModel.create({
        agentId: agent.id,
        content: 'q2',
        parentId: a1.id,
        role: 'user',
        topicId: topic.id,
      });
      return { a1, agent, topic, u1, u2 };
    };

    it('hides the message, re-parents its child, and splices it back on restore', async () => {
      const { a1, topic, u1, u2 } = await seedChain();

      const [root] = await service.trashMessages([a1.id]);
      expect(root.resourceType).toBe('message');
      expect(root.title).toBe('a1');
      expect(root.meta?.messageTree).toEqual({ childIds: [u2.id], parentId: u1.id });

      // hidden from the topic's message list, child re-parented onto u1
      const visible = await messageModel.query({ topicId: topic.id });
      expect(visible.map((m) => m.id).sort()).toEqual([u1.id, u2.id].sort());
      const [u2Row] = await serverDB.select().from(messages).where(eq(messages.id, u2.id));
      expect(u2Row.parentId).toBe(u1.id);
      // still on disk
      const [a1Row] = await serverDB.select().from(messages).where(eq(messages.id, a1.id));
      expect(a1Row.deletedAt).toBeTruthy();

      const outcome = await service.restore([root.id]);
      expect(outcome.failed).toEqual([]);
      const [u2After] = await serverDB.select().from(messages).where(eq(messages.id, u2.id));
      expect(u2After.parentId).toBe(a1.id);
      expect((await messageModel.query({ topicId: topic.id })).map((m) => m.id).sort()).toEqual(
        [u1.id, a1.id, u2.id].sort(),
      );
    });

    it('refuses to restore a message whose topic is in the bin, then purges it for good', async () => {
      const { a1, topic } = await seedChain();
      const [msgRoot] = await service.trashMessages([a1.id]);
      const [topicRoot] = await service.trashTopics([topic.id]);

      const blocked = await service.restore([msgRoot.id]);
      expect(blocked.failed).toEqual([{ code: 'parentTrashed', id: msgRoot.id }]);

      await service.purge([msgRoot.id]);
      expect(await serverDB.select().from(messages).where(eq(messages.id, a1.id))).toHaveLength(0);
      expect((await service.list()).items.map((i) => i.id)).toEqual([topicRoot.id]);
    });

    it('takes tool companions along as children of the assistant turn', async () => {
      const { agent, topic, u1 } = await seedChain();
      const assistant = await messageModel.create({
        agentId: agent.id,
        content: '',
        parentId: u1.id,
        role: 'assistant',
        tools: [
          { apiName: 'search', arguments: '{}', id: 'call_1', identifier: 'web', type: 'default' },
        ],
        topicId: topic.id,
      });
      const tool = await messageModel.create({
        agentId: agent.id,
        content: 'result',
        parentId: assistant.id,
        plugin: { apiName: 'search', arguments: '{}', identifier: 'web', type: 'default' },
        role: 'tool',
        tool_call_id: 'call_1',
        topicId: topic.id,
      } as any);

      const [root] = await service.trashMessages([assistant.id]);
      const children = await trashModel.findChildren(root.id);
      expect(children.map((c) => c.resourceId)).toEqual([tool.id]);
      const [toolRow] = await serverDB.select().from(messages).where(eq(messages.id, tool.id));
      expect(toolRow.deletedAt).toBeTruthy();

      await service.restore([root.id]);
      const [toolAfter] = await serverDB.select().from(messages).where(eq(messages.id, tool.id));
      expect(toolAfter.deletedAt).toBeNull();
    });
  });

  describe('sweep', () => {
    it('purges only expired roots, across users, and prunes stale registry rows', async () => {
      const otherService = new TrashService(serverDB, otherUserId);
      const otherTopicModel = new TopicModel(serverDB, otherUserId);

      const mine = await topicModel.create({ title: 'mine' });
      const theirs = await otherTopicModel.create({ title: 'theirs' });
      const fresh = await topicModel.create({ title: 'fresh' });
      const [mineRoot] = await service.trashTopics([mine.id]);
      const [theirsRoot] = await otherService.trashTopics([theirs.id]);
      await service.trashTopics([fresh.id]);
      // backdate two of them past the retention window
      const past = new Date(Date.now() - 1000);
      await serverDB
        .update(trashItems)
        .set({ expiresAt: past })
        .where(eq(trashItems.id, mineRoot.id));
      await serverDB
        .update(trashItems)
        .set({ expiresAt: past })
        .where(eq(trashItems.id, theirsRoot.id));
      // and one orphan registry row whose topic vanished through another path
      await trashModel.register({
        deletedAt: new Date(),
        root: { resourceId: 'tpc_ghost', resourceType: 'topic' },
      });

      const outcome = await TrashService.sweepExpired(serverDB);
      expect(outcome).toEqual({ failed: 0, pruned: 1, purged: 2 });
      expect(await serverDB.select().from(topics).where(eq(topics.id, mine.id))).toHaveLength(0);
      expect(await serverDB.select().from(topics).where(eq(topics.id, theirs.id))).toHaveLength(0);
      expect(await serverDB.select().from(topics).where(eq(topics.id, fresh.id))).toHaveLength(1);
      expect((await service.list()).items.map((i) => i.resourceId)).toEqual([fresh.id]);
    });

    it('emptyTrash purges everything in scope', async () => {
      const a = await topicModel.create({ title: 'a' });
      const b = await topicModel.create({ title: 'b' });
      await service.trashTopics([a.id, b.id]);
      const { purged } = await service.emptyTrash();
      expect(purged).toBe(2);
      expect((await service.list()).items).toHaveLength(0);
      expect(await serverDB.select().from(topics)).toHaveLength(0);
    });

    it('emptyTrash scoped to an actor clears every one of their roots, not just a first page', async () => {
      // A workspace non-owner may only empty what they trashed themselves. The
      // filter has to live in the query: applying it to one page of results
      // would silently leave the rest behind while the UI says "emptied".
      const workspaceId = 'trash-empty-ws';
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'ws',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      const mine = new TrashService(serverDB, userId, workspaceId);
      const theirs = new TrashService(serverDB, otherUserId, workspaceId);
      const myTopics = new TopicModel(serverDB, userId, workspaceId);
      const theirTopics = new TopicModel(serverDB, otherUserId, workspaceId);

      for (let i = 0; i < 3; i++) {
        const t = await myTopics.create({ title: `mine ${i}` });
        await mine.trashTopics([t.id]);
      }
      const theirTopic = await theirTopics.create({ title: 'theirs' });
      await theirs.trashTopics([theirTopic.id]);

      const { purged } = await mine.emptyTrash({ deletedByUserId: userId });

      expect(purged).toBe(3);
      // the teammate's row is untouched and still listed workspace-wide
      const left = await mine.list();
      expect(left.items.map((item) => item.resourceId)).toEqual([theirTopic.id]);
    });
  });
});
