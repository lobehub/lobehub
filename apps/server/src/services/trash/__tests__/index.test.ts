// @vitest-environment node
import { TRASH_EMPTY_BATCH_SIZE } from '@lobechat/const';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { DashboardModel } from '@/database/models/dashboard';
import { MessageModel } from '@/database/models/message';
import { SessionModel } from '@/database/models/session';
import { TopicModel } from '@/database/models/topic';
import { TrashModel } from '@/database/models/trash';
import { WidgetModel } from '@/database/models/widget';
import { HomeRepository } from '@/database/repositories/home';
import {
  agents,
  dashboards,
  messages,
  sessions,
  topics,
  trashItems,
  users,
  widgets,
  workspaces,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { TrashService } from '../index';

// Lets a test land a concurrent purge between a restore handler's reads and its
// write: the handlers check the owning agent right before restoring, inside the
// restore transaction (the hook receives that transaction).
const restoreRace = vi.hoisted(() => ({
  afterOwnerCheck: undefined as undefined | ((db: any) => Promise<void>),
}));

vi.mock('@/database/models/agent', async (importOriginal) => {
  const mod = await importOriginal<{ AgentModel: typeof AgentModel }>();
  class PatchedAgentModel extends mod.AgentModel {
    constructor(...args: ConstructorParameters<typeof AgentModel>) {
      super(...args);
      const hasTrashedOwner = this.hasTrashedOwner;
      this.hasTrashedOwner = async (owner) => {
        const result = await hasTrashedOwner(owner);
        await restoreRace.afterOwnerCheck?.(args[0]);
        return result;
      };
    }
  }
  return { ...mod, AgentModel: PatchedAgentModel };
});

// Lets a test make the sharing-grant cleanup of an agent purge fail once.
const permissionCleanup = vi.hoisted(() => ({
  calls: [] as unknown[][],
  failNext: false,
}));

vi.mock('@/database/models/resourcePermission', async (importOriginal) => {
  const mod = await importOriginal<{ ResourcePermissionModel: any }>();
  class PatchedResourcePermissionModel extends mod.ResourcePermissionModel {
    constructor(...args: any[]) {
      super(...args);
      const removeAll = this.removeAll;
      this.removeAll = async (...callArgs: any[]) => {
        permissionCleanup.calls.push(callArgs);
        if (permissionCleanup.failNext) {
          permissionCleanup.failNext = false;
          throw new Error('transient');
        }
        return removeAll(...callArgs);
      };
    }
  }
  return { ...mod, ResourcePermissionModel: PatchedResourcePermissionModel };
});

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
  restoreRace.afterOwnerCheck = undefined;
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

    it('does not report a topic restored when a purge removed it mid-restore', async () => {
      const agent = await agentModel.create({ title: 'Bot' });
      const topic = await topicModel.create({ agentId: agent.id, title: 'Gone' });
      const [root] = await service.trashTopics([topic.id]);
      // The expiry sweep deletes the row after the handler read it as trashed.
      restoreRace.afterOwnerCheck = async (db) => {
        await db.delete(topics).where(eq(topics.id, topic.id));
      };

      const outcome = await service.restore([root.id]);

      expect(outcome.restored).toEqual([]);
      expect(outcome.failed).toEqual([{ code: 'notFound', id: root.id }]);
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

    it('refuses to restore a legacy session-only topic whose agent is still in the bin', async () => {
      const session = await sessionModel.create({ config: { title: 'Legacy' }, type: 'agent' });
      const agent = (await sessionModel.findByIdOrSlug(session.id))!.agent;
      // no agentId: linked to the agent only through its session shell
      const topic = await topicModel.create({ sessionId: session.id, title: 'via session' });
      const [topicRoot] = await service.trashTopics([topic.id]);
      await service.trashAgent(agent.id);

      const outcome = await service.restore([topicRoot.id]);
      expect(outcome.failed).toEqual([{ code: 'parentTrashed', id: topicRoot.id }]);
      expect(await topicModel.findById(topic.id)).toBeUndefined();
    });

    it('takes topic-less messages along and brings them back with the agent', async () => {
      const session = await sessionModel.create({ config: { title: 'Legacy' }, type: 'agent' });
      const agent = (await sessionModel.findByIdOrSlug(session.id))!.agent;
      const byAgent = await messageModel.create({
        agentId: agent.id,
        content: 'topic-less via agent',
        role: 'user',
      });
      const bySession = await messageModel.create({
        content: 'topic-less via session',
        role: 'user',
        sessionId: session.id,
      });
      const other = await agentModel.create({ title: 'Other' });
      const bystander = await messageModel.create({
        agentId: other.id,
        content: 'another agent',
        role: 'user',
      });

      const root = await service.trashAgent(agent.id);
      expect(root?.meta?.childCount).toBe(2);
      expect(await messageModel.findById(byAgent.id)).toBeUndefined();
      expect(await messageModel.findById(bySession.id)).toBeUndefined();
      expect(await messageModel.findById(bystander.id)).toBeTruthy();

      await service.restore([root!.id]);
      expect(await messageModel.findById(byAgent.id)).toBeTruthy();
      expect(await messageModel.findById(bySession.id)).toBeTruthy();
    });

    it('refuses to restore a topic-less message whose agent is still in the bin', async () => {
      const agent = await agentModel.create({ title: 'Bot' });
      const message = await messageModel.create({
        agentId: agent.id,
        content: 'loose',
        role: 'user',
      });
      const [messageRoot] = await service.trashMessages([message.id]);
      await service.trashAgent(agent.id);

      const outcome = await service.restore([messageRoot.id]);
      expect(outcome.failed).toEqual([{ code: 'parentTrashed', id: messageRoot.id }]);
      expect(await messageModel.findById(message.id)).toBeUndefined();
    });

    it('purging an agent also drops the roots of descendants trashed before it', async () => {
      const session = await sessionModel.create({ config: { title: 'Legacy' }, type: 'agent' });
      const agent = (await sessionModel.findByIdOrSlug(session.id))!.agent;
      const viaAgent = await topicModel.create({ agentId: agent.id, title: 'via agent' });
      const viaSession = await topicModel.create({ sessionId: session.id, title: 'via session' });
      const loose = await messageModel.create({
        agentId: agent.id,
        content: 'loose',
        role: 'user',
      });
      // each trashed on its own first, so each keeps a separate root
      await service.trashTopics([viaAgent.id, viaSession.id]);
      await service.trashMessages([loose.id]);
      const root = await service.trashAgent(agent.id);
      expect((await service.list()).items).toHaveLength(4);

      await service.purge([root!.id]);

      // the cascade deleted all three resources, so none of their rows may linger
      expect((await service.list()).items).toEqual([]);
      expect(await service.countByType()).toEqual({});
      expect(await serverDB.select().from(trashItems)).toHaveLength(0);
    });

    it('rolls the whole agent purge back when grant cleanup fails, so a retry still cleans up', async () => {
      const workspaceId = 'trash-purge-ws';
      await serverDB
        .insert(workspaces)
        .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: workspaceId });
      const wsService = new TrashService(serverDB, userId, workspaceId);
      const wsAgents = new AgentModel(serverDB, userId, workspaceId);
      const agent = await wsAgents.create({ title: 'Shared bot' });
      const root = await wsService.trashAgent(agent.id);

      permissionCleanup.failNext = true;
      await expect(wsService.purge([root!.id])).rejects.toThrow('transient');

      // nothing committed: the agent is still in the bin and still listed
      expect(await wsAgents.findTrashedByIds([agent.id])).toHaveLength(1);
      expect((await wsService.list()).items.map((i) => i.id)).toEqual([root!.id]);

      await wsService.purge([root!.id]);
      expect(permissionCleanup.calls.at(-1)).toEqual(['agent', agent.id]);
      expect(await serverDB.select().from(agents).where(eq(agents.id, agent.id))).toHaveLength(0);
      expect((await wsService.list()).items).toEqual([]);
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

    it('a purge that lands after a concurrent restore leaves the restored agent and its session alone', async () => {
      const session = await sessionModel.create({ config: { title: 'Legacy' }, type: 'agent' });
      const agent = (await sessionModel.findByIdOrSlug(session.id))!.agent;
      const root = await service.trashAgent(agent.id);
      // restore commits between the purge's registry read and its delete
      await agentModel.restore([agent.id]);

      await service.purge([root!.id]);
      expect(await agentModel.existsById(agent.id)).toBe(true);
      expect(
        await serverDB.select().from(sessions).where(eq(sessions.id, session.id)),
      ).toHaveLength(1);
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

    it('does not report a message restored when a purge removed it mid-restore', async () => {
      const { a1 } = await seedChain();
      const [msgRoot] = await service.trashMessages([a1.id]);
      restoreRace.afterOwnerCheck = async (db) => {
        await db.delete(messages).where(eq(messages.id, a1.id));
      };

      const outcome = await service.restore([msgRoot.id]);

      expect(outcome.restored).toEqual([]);
      expect(outcome.failed).toEqual([{ code: 'notFound', id: msgRoot.id }]);
    });

    it('a purge that lands after a concurrent restore leaves the restored message alone', async () => {
      const { a1 } = await seedChain();
      const [msgRoot] = await service.trashMessages([a1.id]);
      await messageModel.restoreMessages([{ id: a1.id }]);

      await service.purge([msgRoot.id]);
      expect(await messageModel.findById(a1.id)).toBeTruthy();
    });

    it('keeps a branch picked while an intermediate message was in the bin', async () => {
      const agent = await agentModel.create({ title: 'Bot' });
      const topic = await topicModel.create({ agentId: agent.id, title: 't' });
      const at = (s: number) => new Date(Date.UTC(2026, 8, 1, 0, 0, s));
      const base = { agentId: agent.id, topicId: topic.id, userId };
      await serverDB.insert(messages).values([
        { ...base, content: 'q', createdAt: at(1), id: 'br_u', role: 'user' },
        {
          ...base,
          content: 'answer x',
          createdAt: at(2),
          id: 'br_x',
          parentId: 'br_u',
          role: 'assistant',
        },
        {
          ...base,
          content: 'answer s',
          createdAt: at(3),
          id: 'br_s',
          parentId: 'br_u',
          role: 'assistant',
        },
        {
          ...base,
          content: 'follow-up',
          createdAt: at(4),
          id: 'br_c',
          parentId: 'br_x',
          role: 'user',
        },
      ]);

      // Trash the intermediate answer: its follow-up now sits beside the sibling…
      const [root] = await service.trashMessages(['br_x']);
      // …and the user switches to it there (branches of br_u: [br_s, br_c]).
      await serverDB
        .update(messages)
        .set({ metadata: { activeBranchIndex: 1 } })
        .where(eq(messages.id, 'br_u'));

      await service.restore([root.id]);

      // br_c is back under br_x; the selection follows it (branches: [br_x, br_s])
      const [parent] = await serverDB.select().from(messages).where(eq(messages.id, 'br_u'));
      expect((parent.metadata as { activeBranchIndex?: number }).activeBranchIndex).toBe(0);
      const [child] = await serverDB.select().from(messages).where(eq(messages.id, 'br_c'));
      expect(child.parentId).toBe('br_x');
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

    it('files each tool companion under its own assistant turn in a multi-select delete', async () => {
      const { agent, topic, u1 } = await seedChain();
      const turn = async (callId: string) => {
        const assistant = await messageModel.create({
          agentId: agent.id,
          content: '',
          parentId: u1.id,
          role: 'assistant',
          tools: [
            { apiName: 'search', arguments: '{}', id: callId, identifier: 'web', type: 'default' },
          ],
          topicId: topic.id,
        });
        const tool = await messageModel.create({
          agentId: agent.id,
          content: 'result',
          parentId: assistant.id,
          plugin: { apiName: 'search', arguments: '{}', identifier: 'web', type: 'default' },
          role: 'tool',
          tool_call_id: callId,
          topicId: topic.id,
        } as any);
        return { assistant, tool };
      };
      const first = await turn('call_a');
      const second = await turn('call_b');

      const roots = await service.trashMessages([first.assistant.id, second.assistant.id]);
      const rootOf = (id: string) => roots.find((r) => r.resourceId === id)!;
      const childrenOf = async (id: string) =>
        (await trashModel.findChildren(rootOf(id).id)).map((c) => c.resourceId);
      expect(await childrenOf(first.assistant.id)).toEqual([first.tool.id]);
      expect(await childrenOf(second.assistant.id)).toEqual([second.tool.id]);

      // Restoring the second turn alone brings its own tool result back …
      await service.restore([rootOf(second.assistant.id).id]);
      const toolRow = async (id: string) =>
        (await serverDB.select().from(messages).where(eq(messages.id, id)))[0];
      expect((await toolRow(second.tool.id)).deletedAt).toBeNull();
      // … and purging the first turn leaves it alone.
      await service.purge([rootOf(first.assistant.id).id]);
      expect(await toolRow(first.tool.id)).toBeUndefined();
      expect(await toolRow(second.tool.id)).toBeTruthy();
    });

    it('refuses to restore a message whose parent message is still in the bin', async () => {
      const { a1, u2 } = await seedChain();
      const roots = await service.trashMessages([a1.id, u2.id]);
      const ancestorRoot = roots.find((r) => r.resourceId === a1.id)!;
      const descendantRoot = roots.find((r) => r.resourceId === u2.id)!;

      const blocked = await service.restore([descendantRoot.id]);
      expect(blocked.failed).toEqual([{ code: 'parentTrashed', id: descendantRoot.id }]);
      const [u2Row] = await serverDB.select().from(messages).where(eq(messages.id, u2.id));
      expect(u2Row.deletedAt).toBeTruthy();

      // Restored together, the order they are handed over in does not matter.
      const outcome = await service.restore([descendantRoot.id, ancestorRoot.id]);
      expect(outcome.failed).toEqual([]);
      expect(outcome.restored.map((i) => i.id).sort()).toEqual(
        [ancestorRoot.id, descendantRoot.id].sort(),
      );
      const [u2After] = await serverDB.select().from(messages).where(eq(messages.id, u2.id));
      expect(u2After.deletedAt).toBeNull();
      expect(u2After.parentId).toBe(a1.id);
    });
  });

  describe('widgets', () => {
    it('restores a trashed widget from the bin', async () => {
      const widgetModel = new WidgetModel(serverDB, userId);
      const widget = await widgetModel.create({ title: 'Open PRs' });
      await widgetModel.trash(widget.id);

      const { items } = await service.list();
      expect(items.map((i) => [i.resourceType, i.resourceId])).toEqual([['widget', widget.id]]);

      const outcome = await service.restore(items.map((i) => i.id));
      expect(outcome.failed).toEqual([]);
      expect(outcome.restored).toHaveLength(1);
      expect(await widgetModel.findById(widget.id)).toMatchObject({
        id: widget.id,
        isDeleted: null,
      });
      expect(await serverDB.select().from(trashItems)).toHaveLength(0);
    });

    it('purges a trashed widget when the bin is emptied', async () => {
      const widgetModel = new WidgetModel(serverDB, userId);
      const widget = await widgetModel.create({ title: 'Open PRs' });
      await widgetModel.trash(widget.id);

      expect(await service.emptyTrash()).toEqual({ hasMore: false, purged: 1 });
      expect(await serverDB.select().from(widgets)).toHaveLength(0);
      expect(await serverDB.select().from(trashItems)).toHaveLength(0);
    });
  });

  describe('dashboards', () => {
    it('restores a trashed dashboard from the bin', async () => {
      const dashboardModel = new DashboardModel(serverDB, userId);
      const board = await dashboardModel.create({ title: 'Ops' });
      await dashboardModel.trash(board.id);

      const { items } = await service.list();
      expect(items.map((i) => [i.resourceType, i.resourceId])).toEqual([['dashboard', board.id]]);

      const outcome = await service.restore(items.map((i) => i.id));
      expect(outcome.failed).toEqual([]);
      expect(outcome.restored).toHaveLength(1);
      expect(await dashboardModel.findById(board.id)).toMatchObject({
        id: board.id,
        isDeleted: null,
      });
      expect(await serverDB.select().from(trashItems)).toHaveLength(0);
    });

    it('purges a trashed dashboard when the bin is emptied', async () => {
      const dashboardModel = new DashboardModel(serverDB, userId);
      const board = await dashboardModel.create({ title: 'Ops' });
      await dashboardModel.trash(board.id);

      expect(await service.emptyTrash()).toEqual({ hasMore: false, purged: 1 });
      expect(await serverDB.select().from(dashboards)).toHaveLength(0);
      expect(await serverDB.select().from(trashItems)).toHaveLength(0);
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

    it('emptyTrash purges one bounded batch per call and says when more remain', async () => {
      const created = await Promise.all(
        Array.from({ length: TRASH_EMPTY_BATCH_SIZE + 3 }, (_, i) =>
          topicModel.create({ title: `t${i}` }),
        ),
      );
      await service.trashTopics(created.map((t) => t.id));

      const first = await service.emptyTrash();
      expect(first).toEqual({ hasMore: true, purged: TRASH_EMPTY_BATCH_SIZE });
      expect((await service.countByType()).topic).toBe(3);

      const second = await service.emptyTrash();
      expect(second).toEqual({ hasMore: false, purged: 3 });
      expect(await serverDB.select().from(topics)).toHaveLength(0);
    });

    it('a purge that lands after a concurrent restore leaves the restored topic alone', async () => {
      const topic = await topicModel.create({ title: 'raced' });
      const [root] = await service.trashTopics([topic.id]);
      // The restore commits between the purge's registry read and its delete:
      // the registry row is still there, but the topic is live again.
      await topicModel.restore([topic.id]);

      await service.purge([root.id]);
      expect(await topicModel.findById(topic.id)).toBeTruthy();
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

      const { hasMore, purged } = await mine.emptyTrash({ deletedByUserId: userId });

      expect(purged).toBe(3);
      expect(hasMore).toBe(false);
      // the teammate's row is untouched and still listed workspace-wide
      const left = await mine.list();
      expect(left.items.map((item) => item.resourceId)).toEqual([theirTopic.id]);
    });
  });
});
