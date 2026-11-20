// @vitest-environment node
import { MessageGroupType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messageGroups, messagePlugins, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';
import {
  MAX_COMPRESSED_GROUP_MEMBERS,
  planMessageGroupHydration,
  selectCompressedGroupMembers,
} from '../../message/groupNodes';

const userId = 'compressed-group-members-test-user';
const topicId = 'compressed-group-members-topic';

let messageModel: MessageModel;
let serverDB: LobeChatDatabase;

beforeEach(async () => {
  serverDB = await getTestDB();

  await serverDB.delete(messageGroups);
  await serverDB.delete(messages);
  await serverDB.delete(topics);
  await serverDB.delete(users);

  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({ id: topicId, userId });

  messageModel = new MessageModel(serverDB, userId);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('MessageModel.query compression group member cap', () => {
  describe('large compression groups', () => {
    it('should hydrate only the newest members, aligned to a round start, keeping pinned ones', async () => {
      // One more than the cap plus 20, so the newest-cap slice starts on an assistant
      // row (odd index) and is trimmed forward to the next user message.
      const total = MAX_COMPRESSED_GROUP_MEMBERS + 21;
      const base = Date.parse('2024-01-01T00:00:00Z');
      await serverDB.insert(messages).values(
        Array.from({ length: total }, (_, i) => ({
          content: `member ${i}`,
          createdAt: new Date(base + i * 1000),
          favorite: i === 0,
          id: `big-${String(i).padStart(4, '0')}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          topicId,
          userId,
        })),
      );
      await serverDB.insert(messageGroups).values({
        content: 'Summary of a long conversation',
        createdAt: new Date(base + total * 1000),
        id: 'big-group',
        topicId,
        type: MessageGroupType.Compression,
        userId,
      });
      await serverDB.update(messages).set({ messageGroupId: 'big-group' });

      const result = await messageModel.query({ topicId });
      const node = result.find((m) => m.role === 'compressedGroup') as any;

      // Slice = indices [21, total) trimmed to the first user row (22).
      const omitted = 22;
      expect(node.compressedOmittedIds).toHaveLength(omitted);
      expect(node.compressedOmittedIds[0]).toBe('big-0000');
      expect(node.compressedOmittedIds.at(-1)).toBe('big-0021');
      // Every even index is a user message: the whole group's turns, not the slice's.
      expect(node.compressedTurnCount).toBe(Math.ceil(total / 2));
      const ids = node.compressedMessages.map((m: any) => m.id);
      expect(ids).not.toContain('big-0000');
      expect(ids).not.toContain('big-0021');
      expect(ids[0]).toBe('big-0022');
      expect(ids.at(-1)).toBe(`big-${String(total - 1).padStart(4, '0')}`);
      expect(node.compressedMessages).toHaveLength(total - omitted);

      // The pinned member predates the slice but still loads; the chain link
      // still points at the group's real last member.
      expect(node.pinnedMessages.map((m: any) => m.id)).toEqual(['big-0000']);
      expect(node.lastMessageId).toBe(`big-${String(total - 1).padStart(4, '0')}`);
    });

    it('should leave a group within the cap untouched', async () => {
      await serverDB.insert(messages).values([
        { content: 'a', id: 'small-1', role: 'user', topicId, userId },
        { content: 'b', id: 'small-2', role: 'assistant', topicId, userId },
      ]);
      await serverDB.insert(messageGroups).values({
        content: 'Summary',
        id: 'small-group',
        topicId,
        type: MessageGroupType.Compression,
        userId,
      });
      await serverDB.update(messages).set({ messageGroupId: 'small-group' });

      const result = await messageModel.query({ topicId });
      const node = result.find((m) => m.role === 'compressedGroup') as any;

      expect(node.compressedOmittedIds).toBeUndefined();
      expect(node.compressedTurnCount).toBeUndefined();
      expect(node.compressedMessages).toHaveLength(2);
    });
  });

  describe('state-bearing members outside the hydrated slice', () => {
    it('should keep only the plugin state of omitted members that later runs restore', async () => {
      const total = MAX_COMPRESSED_GROUP_MEMBERS + 21;
      const base = Date.parse('2024-01-01T00:00:00Z');
      const idOf = (i: number) => `st-${String(i).padStart(4, '0')}`;
      // Indices 1..4 are omitted tool rows: an activator call, a TODO write
      // from another tool, a plain tool result that carries no state, and a
      // non-activation `lobe-skills` call (its command state is not restored).
      const toolRows = new Set([1, 2, 3, 4]);
      await serverDB.insert(messages).values(
        Array.from({ length: total }, (_, i) => ({
          content: `member ${i}`,
          createdAt: new Date(base + i * 1000),
          id: idOf(i),
          role: toolRows.has(i) ? 'tool' : i % 2 === 0 ? 'user' : 'assistant',
          topicId,
          userId,
        })),
      );
      await serverDB.insert(messagePlugins).values([
        {
          apiName: 'activateTools',
          id: idOf(1),
          identifier: 'lobe-activator',
          state: { activatedTools: [{ identifier: 'lobe-task' }] },
          userId,
        },
        {
          apiName: 'writeTodos',
          id: idOf(2),
          identifier: 'lobe-agent',
          state: { todos: { items: [{ status: 'todo', text: 'ship it' }] } },
          userId,
        },
        {
          apiName: 'search',
          id: idOf(3),
          identifier: 'lobe-web-browsing',
          state: { results: [] },
          userId,
        },
        {
          apiName: 'runCommand',
          id: idOf(4),
          identifier: 'lobe-skills',
          state: { command: 'x'.repeat(1000) },
          userId,
        },
      ]);
      await serverDB.insert(messageGroups).values({
        content: 'Summary',
        createdAt: new Date(base + total * 1000),
        id: 'state-group',
        topicId,
        type: MessageGroupType.Compression,
        userId,
      });
      await serverDB.update(messages).set({ messageGroupId: 'state-group' });

      const result = await messageModel.query({ topicId });
      const node = result.find((m) => m.role === 'compressedGroup') as any;

      // Kept as flat tool rows ahead of the hydrated slice, where every released
      // client's runtime selectors already look for them.
      const stateRows = node.compressedMessages.filter((m: any) => m.role === 'tool');
      expect(stateRows.map((m: any) => m.id)).toEqual([idOf(1), idOf(2)]);
      expect(node.compressedMessages.slice(0, 2)).toEqual(stateRows);
      expect(stateRows[0]).toMatchObject({
        content: '',
        plugin: { apiName: 'activateTools', identifier: 'lobe-activator', type: 'default' },
        pluginState: { activatedTools: [{ identifier: 'lobe-task' }] },
      });
      expect(stateRows[1]).toMatchObject({
        plugin: { apiName: 'writeTodos', identifier: 'lobe-agent', type: 'default' },
        pluginState: { todos: { items: [{ status: 'todo', text: 'ship it' }] } },
      });
    });

    it('should not add state messages when nothing was omitted', async () => {
      await serverDB.insert(messages).values([
        {
          content: 'a',
          createdAt: new Date('2024-01-01T00:00:00Z'),
          id: 'st-small-1',
          role: 'user',
          topicId,
          userId,
        },
        {
          content: 'b',
          createdAt: new Date('2024-01-01T00:00:01Z'),
          id: 'st-small-2',
          role: 'tool',
          topicId,
          userId,
        },
      ]);
      await serverDB.insert(messagePlugins).values({
        apiName: 'activateTools',
        id: 'st-small-2',
        identifier: 'lobe-activator',
        state: { activatedTools: [{ identifier: 'lobe-task' }] },
        userId,
      });
      await serverDB.insert(messageGroups).values({
        content: 'Summary',
        id: 'st-small-group',
        topicId,
        type: MessageGroupType.Compression,
        userId,
      });
      await serverDB.update(messages).set({ messageGroupId: 'st-small-group' });

      const result = await messageModel.query({ topicId });
      const node = result.find((m) => m.role === 'compressedGroup') as any;

      // The single tool row is hydrated as a normal member, not duplicated.
      expect(node.compressedMessages.map((m: any) => m.id)).toEqual(['st-small-1', 'st-small-2']);
    });
  });

  describe('skipCompressedMembers', () => {
    const seedGroup = async () => {
      const at = (s: number) => new Date(Date.parse('2024-01-01T00:00:00Z') + s * 1000);
      await serverDB.insert(messages).values([
        {
          content: 'MEMBER QUESTION',
          createdAt: at(0),
          favorite: true,
          id: 'sk-1',
          role: 'user',
          topicId,
          userId,
        },
        {
          content: 'MEMBER ANSWER',
          createdAt: at(1),
          id: 'sk-2',
          role: 'assistant',
          topicId,
          userId,
        },
        {
          content: 'MEMBER TOOL RESULT',
          createdAt: at(2),
          id: 'sk-3',
          role: 'tool',
          topicId,
          userId,
        },
        {
          content: 'MEMBER FOLLOW-UP',
          createdAt: at(3),
          id: 'sk-4',
          role: 'user',
          topicId,
          userId,
        },
      ]);
      await serverDB.insert(messagePlugins).values({
        apiName: 'activateTools',
        id: 'sk-3',
        identifier: 'lobe-activator',
        state: { activatedTools: [{ identifier: 'lobe-task' }] },
        userId,
      });
      await serverDB.insert(messageGroups).values({
        content: 'Summary of the group',
        createdAt: at(4),
        id: 'sk-group',
        topicId,
        type: MessageGroupType.Compression,
        userId,
      });
      await serverDB.update(messages).set({ messageGroupId: 'sk-group' });
      // A mainline message after the group, which the option leaves alone.
      await serverDB.insert(messages).values({
        content: 'MAINLINE AFTER',
        createdAt: at(5),
        id: 'sk-main',
        parentId: 'sk-4',
        role: 'user',
        topicId,
        userId,
      });
    };

    it('should keep the summary, member ids and runtime state but no member content', async () => {
      await seedGroup();

      const result = await messageModel.query({ skipCompressedMembers: true, topicId });
      const node = result.find((m) => m.role === 'compressedGroup') as any;

      expect(node).toMatchObject({
        compressedOmittedIds: ['sk-1', 'sk-2', 'sk-3', 'sk-4'],
        compressedTurnCount: 2,
        content: 'Summary of the group',
        lastMessageId: 'sk-4',
        pinnedMessages: [],
      });
      // Only the state-bearing member, as a flat tool row without content.
      expect(node.compressedMessages).toHaveLength(1);
      expect(node.compressedMessages[0]).toMatchObject({
        content: '',
        id: 'sk-3',
        plugin: { apiName: 'activateTools', identifier: 'lobe-activator' },
        pluginState: { activatedTools: [{ identifier: 'lobe-task' }] },
        role: 'tool',
      });
      expect(JSON.stringify(node)).not.toContain('MEMBER');

      expect(result.find((m) => m.id === 'sk-main')?.content).toBe('MAINLINE AFTER');
    });

    it('should hydrate a group whose branches carry runtime state, keeping only the active branch', async () => {
      const at = (s: number) => new Date(Date.parse('2024-01-01T00:00:00Z') + s * 1000);
      const todos = (text: string) => ({
        todos: { items: [{ status: 'todo', text }], updatedAt: '2024-01-01T00:00:00.000Z' },
      });
      // The user regenerated the reply, then switched back to the first branch.
      await serverDB.insert(messages).values([
        {
          content: 'BRANCH QUESTION',
          createdAt: at(0),
          id: 'br-u',
          metadata: { activeBranchIndex: 0 },
          role: 'user',
          topicId,
          userId,
        },
        {
          content: 'ACTIVE ANSWER',
          createdAt: at(1),
          id: 'br-a1',
          parentId: 'br-u',
          role: 'assistant',
          tools: [
            {
              apiName: 'createTodos',
              arguments: '{}',
              id: 'call-1',
              identifier: 'lobe-gtd',
              type: 'builtin',
            },
          ],
          topicId,
          userId,
        },
        {
          content: '',
          createdAt: at(2),
          id: 'br-t1',
          parentId: 'br-a1',
          role: 'tool',
          topicId,
          userId,
        },
        {
          content: 'ABANDONED ANSWER',
          createdAt: at(3),
          id: 'br-a2',
          parentId: 'br-u',
          role: 'assistant',
          tools: [
            {
              apiName: 'createTodos',
              arguments: '{}',
              id: 'call-2',
              identifier: 'lobe-gtd',
              type: 'builtin',
            },
          ],
          topicId,
          userId,
        },
        {
          content: '',
          createdAt: at(4),
          id: 'br-t2',
          parentId: 'br-a2',
          role: 'tool',
          topicId,
          userId,
        },
      ]);
      await serverDB.insert(messagePlugins).values([
        {
          apiName: 'createTodos',
          id: 'br-t1',
          identifier: 'lobe-gtd',
          state: todos('ACTIVE TODO'),
          toolCallId: 'call-1',
          userId,
        },
        {
          apiName: 'createTodos',
          id: 'br-t2',
          identifier: 'lobe-gtd',
          state: todos('ABANDONED TODO'),
          toolCallId: 'call-2',
          userId,
        },
      ]);
      await serverDB.insert(messageGroups).values({
        content: 'Summary of the branched group',
        createdAt: at(5),
        id: 'br-group',
        topicId,
        type: MessageGroupType.Compression,
        userId,
      });
      await serverDB.update(messages).set({ messageGroupId: 'br-group' });

      const result = await messageModel.query({ skipCompressedMembers: true, topicId });
      const node = result.find((m) => m.role === 'compressedGroup') as any;
      const serialized = JSON.stringify(node.compressedMessages);

      expect(node.compressedOmittedIds).toBeUndefined();
      expect(serialized).toContain('ACTIVE TODO');
      expect(serialized).not.toContain('ABANDONED TODO');
    });

    it('should still skip a branched group that carries no runtime state', () => {
      const record = (id: string, role: string, parentBranches: boolean) => ({
        carriesTodos: false,
        favorite: null,
        id,
        messageGroupId: 'g',
        parentBranches,
        pluginApiName: null,
        pluginIdentifier: null,
        role,
      });
      const plan = planMessageGroupHydration(
        [{ id: 'g', type: MessageGroupType.Compression }],
        [
          record('u', 'user', false),
          record('a1', 'assistant', true),
          record('a2', 'assistant', true),
        ],
        true,
      );

      expect(plan.idsToHydrate).toEqual([]);
      expect(plan.hydratedByGroup.get('g')).toEqual([]);
    });

    it('should still hydrate the members without the option', async () => {
      await seedGroup();

      const result = await messageModel.query({ topicId });
      const node = result.find((m) => m.role === 'compressedGroup') as any;

      expect(node.compressedOmittedIds).toBeUndefined();
      expect(node.pinnedMessages.map((m: any) => m.id)).toEqual(['sk-1']);
      expect(JSON.stringify(node.compressedMessages)).toContain('MEMBER ANSWER');
    });
  });

  describe('selectCompressedGroupMembers', () => {
    const rows = (roles: string[]) => roles.map((role, i) => ({ id: String(i), role }));

    it('returns every member when within the limit', () => {
      const members = rows(['user', 'assistant']);
      expect(selectCompressedGroupMembers(members, 2)).toBe(members);
    });

    it('keeps the newest members and trims forward to a user message', () => {
      const members = rows(['user', 'assistant', 'tool', 'assistant', 'user', 'assistant']);
      expect(selectCompressedGroupMembers(members, 4).map((m) => m.id)).toEqual(['4', '5']);
    });

    it('keeps the newest slice whole when it holds no user message', () => {
      const members = rows(['user', 'assistant', 'tool', 'assistant']);
      expect(selectCompressedGroupMembers(members, 3).map((m) => m.id)).toEqual(['1', '2', '3']);
    });
  });
});
