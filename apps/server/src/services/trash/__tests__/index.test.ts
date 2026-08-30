// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { TrashModel } from '@/database/models/trash';
import { messages, topics, trashItems, users, workspaces } from '@/database/schemas';
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
let messageModel: MessageModel;
let trashModel: TrashModel;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  service = new TrashService(serverDB, userId);
  topicModel = new TopicModel(serverDB, userId);
  agentModel = new AgentModel(serverDB, userId);
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
