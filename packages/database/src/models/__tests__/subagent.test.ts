import { ThreadType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  messages,
  sessions,
  subagents,
  threads,
  topics,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';
import { SubagentModel, SubagentNameConflictError, SubagentParentNotFoundError } from '../subagent';
import { ThreadModel } from '../thread';

const userId = 'subagent-user';
const otherUserId = 'subagent-other-user';
const parentAgentId = 'agt_subagent_parent';
const otherParentAgentId = 'agt_subagent_parent_2';
const foreignAgentId = 'agt_subagent_foreign';
const sessionId = 'subagent-session';
const topicId = 'subagent-topic';

const serverDB: LobeChatDatabase = await getTestDB();
const subagentModel = new SubagentModel(serverDB, userId);
const threadModel = new ThreadModel(serverDB, userId);

const createPreset = (name: string, parent = parentAgentId) =>
  subagentModel.create({
    model: 'gpt-4.1-mini',
    name,
    parentAgentId: parent,
    provider: 'openai',
    reasoningEffort: 'low',
    systemRole: `You are ${name}.`,
    tools: ['lobe-web-browsing'],
  });

describe('SubagentModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
    await serverDB.insert(agents).values([
      { id: parentAgentId, title: 'Parent', userId },
      { id: otherParentAgentId, title: 'Parent 2', userId },
      { id: foreignAgentId, title: 'Foreign', userId: otherUserId },
    ]);
    await serverDB.insert(sessions).values({ id: sessionId, userId });
    await serverDB.insert(topics).values({ id: topicId, sessionId, userId });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  describe('CRUD', () => {
    it('creates, reads, updates and deletes a preset with a single model config', async () => {
      const created = await createPreset('researcher');

      expect(created.id).toMatch(/^sub_/);
      expect(created).toMatchObject({
        isEnabled: true,
        model: 'gpt-4.1-mini',
        name: 'researcher',
        parentAgentId,
        provider: 'openai',
        reasoningEffort: 'low',
        systemRole: 'You are researcher.',
        tools: ['lobe-web-browsing'],
      });

      expect(await subagentModel.findById(created.id)).toEqual(created);

      const updated = await subagentModel.update(created.id, {
        description: 'Searches the web',
        isEnabled: false,
        model: 'claude-haiku-5-5',
        provider: 'anthropic',
      });
      expect(updated).toMatchObject({
        description: 'Searches the web',
        isEnabled: false,
        model: 'claude-haiku-5-5',
        provider: 'anthropic',
      });

      await subagentModel.delete(created.id);
      expect(await subagentModel.findById(created.id)).toBeUndefined();
    });

    it('lists presets by parent agent only', async () => {
      await createPreset('a');
      await createPreset('b');
      await createPreset('c', otherParentAgentId);

      const list = await subagentModel.queryByParentAgentId(parentAgentId);
      expect(list.map((item) => item.name)).toEqual(['a', 'b']);
    });

    it('rejects a parent agent the caller cannot see', async () => {
      await expect(createPreset('x', foreignAgentId)).rejects.toBeInstanceOf(
        SubagentParentNotFoundError,
      );
    });

    it('does not read or delete another user preset', async () => {
      const created = await createPreset('mine');
      const otherModel = new SubagentModel(serverDB, otherUserId);

      expect(await otherModel.findById(created.id)).toBeUndefined();
      await otherModel.delete(created.id);
      expect(await subagentModel.findById(created.id)).toBeDefined();
    });
  });

  describe('workspace access', () => {
    const workspaceId = 'ws_subagent';
    const privateAgentId = 'agt_subagent_private';
    const publicAgentId = 'agt_subagent_public';

    beforeEach(async () => {
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'WS',
        primaryOwnerId: otherUserId,
        slug: 'ws-subagent',
      });
      await serverDB.insert(agents).values([
        {
          id: privateAgentId,
          userId: otherUserId,
          visibility: 'private',
          workspaceId,
        },
        { id: publicAgentId, userId: otherUserId, visibility: 'public', workspaceId },
      ]);
    });

    it('hides presets of a teammate private agent but shows a shared one', async () => {
      const owner = new SubagentModel(serverDB, otherUserId, workspaceId);
      const member = new SubagentModel(serverDB, userId, workspaceId);
      const hidden = await owner.create({ name: 'p', parentAgentId: privateAgentId });
      const shared = await owner.create({ name: 's', parentAgentId: publicAgentId });

      expect(await member.findById(hidden.id)).toBeUndefined();
      expect(await member.queryByParentAgentId(privateAgentId)).toEqual([]);
      await member.delete(hidden.id);
      expect(await owner.findById(hidden.id)).toBeDefined();
      await expect(member.update(hidden.id, { name: 'x' })).resolves.toBeUndefined();

      expect((await member.findById(shared.id))?.id).toBe(shared.id);
    });

    it('follows the parent agent across an ownership change', async () => {
      const owner = new SubagentModel(serverDB, otherUserId, workspaceId);
      const preset = await owner.create({ name: 'moved', parentAgentId: privateAgentId });

      await serverDB.update(agents).set({ userId }).where(eq(agents.id, privateAgentId));

      const newOwner = new SubagentModel(serverDB, userId, workspaceId);
      expect((await newOwner.findById(preset.id))?.id).toBe(preset.id);
      expect(await owner.findById(preset.id)).toBeUndefined();
    });
  });

  describe('name uniqueness', () => {
    it('rejects a duplicate name under the same parent', async () => {
      await createPreset('coder');

      await expect(createPreset('coder')).rejects.toBeInstanceOf(SubagentNameConflictError);
      expect(await subagentModel.queryByParentAgentId(parentAgentId)).toHaveLength(1);
    });

    it('rejects renaming onto an existing name under the same parent', async () => {
      await createPreset('coder');
      const other = await createPreset('writer');

      await expect(subagentModel.update(other.id, { name: 'coder' })).rejects.toBeInstanceOf(
        SubagentNameConflictError,
      );
    });

    it('allows the same name under different parents', async () => {
      await createPreset('coder');
      const second = await createPreset('coder', otherParentAgentId);

      expect(second.parentAgentId).toBe(otherParentAgentId);
    });
  });

  describe('thread ownership', () => {
    it('writes subagentId on a thread and reads it back', async () => {
      const preset = await createPreset('runner');
      const thread = await threadModel.create({
        subagentId: preset.id,
        topicId,
        type: ThreadType.Isolation,
      });

      expect(thread.subagentId).toBe(preset.id);
      expect((await threadModel.findById(thread.id))?.subagentId).toBe(preset.id);
      expect((await threadModel.queryByTopicId(topicId))[0].subagentId).toBe(preset.id);
    });

    it('keeps the thread and nulls subagentId when the preset is deleted', async () => {
      const preset = await createPreset('ephemeral');
      const thread = await threadModel.create({
        subagentId: preset.id,
        title: 'kept history',
        topicId,
        type: ThreadType.Isolation,
      });
      await serverDB.insert(messages).values({
        content: 'done',
        id: 'msg_subagent_kept',
        role: 'assistant',
        threadId: thread.id,
        topicId,
        userId,
      });

      await subagentModel.delete(preset.id);

      const [row] = await serverDB.select().from(threads).where(eq(threads.id, thread.id));
      expect(row).toBeDefined();
      expect(row.title).toBe('kept history');
      expect(row.subagentId).toBeNull();
      const kept = await serverDB.select().from(messages).where(eq(messages.threadId, thread.id));
      expect(kept).toHaveLength(1);
    });

    it('deletes presets with their parent agent while keeping threads', async () => {
      const preset = await createPreset('orphan');
      const thread = await threadModel.create({
        subagentId: preset.id,
        topicId,
        type: ThreadType.Isolation,
      });

      await serverDB.delete(agents).where(eq(agents.id, parentAgentId));

      expect(await serverDB.select().from(subagents)).toHaveLength(0);
      expect((await threadModel.findById(thread.id))?.subagentId).toBeNull();
    });

    it('filters threads by subagentId and counts them per subagent', async () => {
      const a = await createPreset('a');
      const b = await createPreset('b');
      const unused = await createPreset('unused');

      const a1 = await threadModel.create({
        subagentId: a.id,
        topicId,
        type: ThreadType.Isolation,
      });
      const a2 = await threadModel.create({
        subagentId: a.id,
        topicId,
        type: ThreadType.Isolation,
      });
      await threadModel.create({ subagentId: b.id, topicId, type: ThreadType.Isolation });
      await threadModel.create({ topicId, type: ThreadType.Isolation });
      await serverDB.insert(messages).values([
        {
          content: 'a1',
          id: 'msg_a1',
          role: 'assistant',
          threadId: a1.id,
          topicId,
          usage: { totalTokens: 100 },
          userId,
        },
        {
          content: 'a2',
          id: 'msg_a2',
          role: 'assistant',
          threadId: a2.id,
          topicId,
          usage: { totalTokens: 50 },
          userId,
        },
        { content: 'tool', id: 'msg_a2_tool', role: 'tool', threadId: a2.id, topicId, userId },
      ]);

      const aThreads = await threadModel.queryBySubagentId(a.id);
      expect(aThreads.map((t) => t.id).sort()).toEqual([a1.id, a2.id].sort());
      expect(aThreads.every((t) => t.subagentId === a.id)).toBe(true);

      const stats = await threadModel.countBySubagentIds([a.id, b.id, unused.id]);
      expect(stats.sort((x, y) => x.subagentId.localeCompare(y.subagentId))).toEqual(
        [
          { subagentId: a.id, threadCount: 2, totalTokens: 150 },
          { subagentId: b.id, threadCount: 1, totalTokens: 0 },
        ].sort((x, y) => x.subagentId.localeCompare(y.subagentId)),
      );
      expect(await threadModel.countBySubagentIds([])).toEqual([]);
    });

    it('pages through a subagent history', async () => {
      const preset = await createPreset('pager');
      const created = await Promise.all(
        [1, 2, 3].map(() =>
          threadModel.create({ subagentId: preset.id, topicId, type: ThreadType.Isolation }),
        ),
      );

      const first = await threadModel.queryBySubagentId(preset.id, { limit: 2 });
      const rest = await threadModel.queryBySubagentId(preset.id, { limit: 2, offset: 2 });

      expect(first).toHaveLength(2);
      expect(rest).toHaveLength(1);
      expect([...first, ...rest].map((t) => t.id).sort()).toEqual(created.map((t) => t.id).sort());
    });

    it('keeps reading legacy threads without a subagent', async () => {
      const legacy = await threadModel.create({ topicId, type: ThreadType.Standalone });

      const list = await threadModel.queryByTopicId(topicId);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(legacy.id);
      expect(list[0].subagentId).toBeNull();
      expect((await threadModel.findById(legacy.id))?.subagentId).toBeNull();
    });
  });

  describe('isolation from agent reads', () => {
    it('never lists presets as agents', async () => {
      const preset = await createPreset('hidden');

      const agentModel = new AgentModel(serverDB, userId);
      const listed = await agentModel.queryAgents({ keyword: 'hidden' });
      expect(listed.map((row) => row.id)).not.toContain(preset.id);
      expect((await agentModel.queryAgents()).map((row) => row.id).sort()).toEqual(
        [otherParentAgentId, parentAgentId].sort(),
      );
      expect(await agentModel.countAgents()).toBe(2);
      expect(await agentModel.getAgentConfigById(preset.id)).toBeFalsy();
    });
  });
});
