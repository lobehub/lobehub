// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, messagePlugins, messages, sessions, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-trash-user';
const otherUserId = 'message-trash-other';
const messageModel = new MessageModel(serverDB, userId);

const deletedAt = new Date('2026-10-19T00:00:00.000Z');

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values({ id: 'trash-topic', title: 'Trash topic', userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

const row = async (id: string) => {
  const [result] = await serverDB.select().from(messages).where(eq(messages.id, id));
  return result;
};

describe('MessageTrashMutations.softDeleteMessages', () => {
  it('returns an empty list for an empty id list', async () => {
    await expect(messageModel.softDeleteMessages([], { deletedAt })).resolves.toEqual([]);
  });

  it('ignores ids outside the caller scope', async () => {
    await serverDB.insert(messages).values({
      content: 'other',
      id: 'other-msg',
      role: 'user',
      userId: otherUserId,
    });

    await expect(messageModel.softDeleteMessages(['other-msg'], { deletedAt })).resolves.toEqual(
      [],
    );
    expect((await row('other-msg')).isDeleted).toBeNull();
  });

  it('stamps the row and returns the tree data a restore needs', async () => {
    await serverDB.insert(messages).values({
      content: 'hello',
      id: 'basic-msg',
      role: 'user',
      topicId: 'trash-topic',
      userId,
    });

    const result = await messageModel.softDeleteMessages(['basic-msg'], { deletedAt });

    expect(result).toEqual([
      {
        childIds: [],
        content: 'hello',
        id: 'basic-msg',
        isCompanion: false,
        ownerId: null,
        parentId: null,
        projectId: null,
        role: 'user',
        topicId: 'trash-topic',
      },
    ]);
    const trashed = await row('basic-msg');
    expect(trashed.isDeleted).toBe(true);
    expect(trashed.deletedAt).toEqual(deletedAt);
  });

  it('pulls the tool companions of a trashed assistant turn in with it', async () => {
    await serverDB.insert(messages).values([
      {
        content: 'assistant',
        id: 'assistant-msg',
        role: 'assistant',
        tools: [{ id: 'call-1' }],
        userId,
      },
      { content: 'tool', id: 'tool-msg', role: 'tool', userId },
    ]);
    await serverDB.insert(messagePlugins).values({
      id: 'tool-msg',
      identifier: 'plugin-1',
      toolCallId: 'call-1',
      userId,
    });

    const result = await messageModel.softDeleteMessages(['assistant-msg'], { deletedAt });

    expect(result).toHaveLength(2);
    expect(result.find((entry) => entry.id === 'assistant-msg')?.isCompanion).toBe(false);
    expect(result.find((entry) => entry.id === 'tool-msg')).toMatchObject({
      isCompanion: true,
      ownerId: 'assistant-msg',
    });
    expect((await row('tool-msg')).isDeleted).toBe(true);
  });

  it('ignores tool payloads without an id when collecting companions', async () => {
    await serverDB.insert(messages).values([
      {
        content: 'assistant',
        id: 'assistant-msg',
        role: 'assistant',
        tools: [{}, { id: 'call-2' }],
        userId,
      },
      { content: 'tool', id: 'tool-msg-2', role: 'tool', userId },
    ]);
    await serverDB.insert(messagePlugins).values({
      id: 'tool-msg-2',
      identifier: 'plugin-1',
      toolCallId: 'call-2',
      userId,
    });

    const result = await messageModel.softDeleteMessages(['assistant-msg'], { deletedAt });

    expect(result.map((entry) => entry.id).sort()).toEqual(['assistant-msg', 'tool-msg-2']);
  });

  it('does not mark an explicitly requested companion row as a companion', async () => {
    await serverDB.insert(messages).values([
      {
        content: 'assistant',
        id: 'assistant-msg',
        role: 'assistant',
        tools: [{ id: 'call-1' }],
        userId,
      },
      { content: 'tool', id: 'tool-msg', role: 'tool', userId },
    ]);
    await serverDB.insert(messagePlugins).values({
      id: 'tool-msg',
      identifier: 'plugin-1',
      toolCallId: 'call-1',
      userId,
    });

    const result = await messageModel.softDeleteMessages(['assistant-msg', 'tool-msg'], {
      deletedAt,
    });

    expect(result).toHaveLength(2);
    expect(result.every((entry) => !entry.isCompanion)).toBe(true);
    expect(result.every((entry) => entry.ownerId === null)).toBe(true);
  });

  it('re-parents live children onto the nearest surviving ancestor', async () => {
    await serverDB.insert(messages).values([
      { content: 'p1', id: 'p1', role: 'user', userId },
      { content: 'p2', id: 'p2', parentId: 'p1', role: 'assistant', userId },
      { content: 'p3', id: 'p3', parentId: 'p2', role: 'user', userId },
      { content: 'p4', id: 'p4', parentId: 'p3', role: 'assistant', userId },
    ]);

    const result = await messageModel.softDeleteMessages(['p2', 'p3'], { deletedAt });

    expect((await row('p4')).parentId).toBe('p1');
    expect(result.find((entry) => entry.id === 'p2')?.childIds).toEqual([]);
  });

  it('re-parents children of a trashed root to the top level', async () => {
    await serverDB.insert(messages).values([
      { content: 'root', id: 'root', role: 'user', userId },
      { content: 'child', id: 'child', parentId: 'root', role: 'assistant', userId },
    ]);

    const result = await messageModel.softDeleteMessages(['root'], { deletedAt });

    expect((await row('child')).parentId).toBeNull();
    expect(result[0].childIds).toEqual(['child']);
  });

  it('shifts the active branch index when an earlier sibling is trashed', async () => {
    await serverDB.insert(messages).values([
      {
        content: 'parent',
        id: 'bp',
        metadata: { activeBranchIndex: 1, collapsed: true },
        role: 'user',
        userId,
      },
      {
        content: 'a',
        createdAt: new Date('2026-01-01T00:00:01Z'),
        id: 'ba',
        parentId: 'bp',
        role: 'assistant',
        userId,
      },
      {
        content: 'b',
        createdAt: new Date('2026-01-01T00:00:02Z'),
        id: 'bb',
        parentId: 'bp',
        role: 'assistant',
        userId,
      },
    ]);

    await messageModel.softDeleteMessages(['ba'], { deletedAt });

    expect((await row('bp')).metadata).toEqual({ activeBranchIndex: 0, collapsed: true });
  });

  it('clears the active branch index when the selected branch is trashed', async () => {
    await serverDB.insert(messages).values([
      { content: 'parent', id: 'bp', metadata: { activeBranchIndex: 1 }, role: 'user', userId },
      { content: 'a', id: 'ba', parentId: 'bp', role: 'assistant', userId },
      { content: 'b', id: 'bb', parentId: 'bp', role: 'assistant', userId },
    ]);

    await messageModel.softDeleteMessages(['bb'], { deletedAt });

    expect((await row('bp')).metadata).toEqual({});
  });

  it('keeps the optimistic branch index at the new branch count', async () => {
    await serverDB.insert(messages).values([
      { content: 'parent', id: 'bp', metadata: { activeBranchIndex: 2 }, role: 'user', userId },
      { content: 'a', id: 'ba', parentId: 'bp', role: 'assistant', userId },
      { content: 'b', id: 'bb', parentId: 'bp', role: 'assistant', userId },
    ]);

    await messageModel.softDeleteMessages(['ba'], { deletedAt });

    expect((await row('bp')).metadata).toEqual({ activeBranchIndex: 1 });
  });

  it('skips branch reconciliation for parents without an active branch index', async () => {
    await serverDB.insert(messages).values([
      { content: 'parent', id: 'bp', metadata: { foo: 'bar' }, role: 'user', userId },
      { content: 'a', id: 'ba', parentId: 'bp', role: 'assistant', userId },
    ]);

    await messageModel.softDeleteMessages(['ba'], { deletedAt });

    expect((await row('bp')).metadata).toEqual({ foo: 'bar' });
  });
});

describe('MessageTrashMutations.restoreMessages', () => {
  it('returns an empty list for an empty entry list', async () => {
    await expect(messageModel.restoreMessages([])).resolves.toEqual([]);
  });

  it('ignores rows that are not in the recycle bin', async () => {
    await serverDB
      .insert(messages)
      .values({ content: 'live', id: 'live-msg', role: 'user', userId });

    await expect(messageModel.restoreMessages([{ id: 'live-msg' }])).resolves.toEqual([]);
    expect((await row('live-msg')).isDeleted).toBeNull();
  });

  it('clears the trash stamp and returns the restored ids', async () => {
    await serverDB.insert(messages).values({
      content: 'trashed',
      deletedAt,
      id: 'restore-msg',
      isDeleted: true,
      role: 'user',
      topicId: 'trash-topic',
      userId,
    });

    await expect(messageModel.restoreMessages([{ id: 'restore-msg' }])).resolves.toEqual([
      'restore-msg',
    ]);
    const restored = await row('restore-msg');
    expect(restored.isDeleted).toBeNull();
    expect(restored.deletedAt).toBeNull();
  });

  it('re-parents the children recorded at trash time back onto the restored row', async () => {
    await serverDB.insert(messages).values([
      { content: 'parent', id: 'restore-parent', role: 'user', userId },
      {
        content: 'trashed',
        deletedAt,
        id: 'restore-msg',
        isDeleted: true,
        parentId: 'restore-parent',
        role: 'assistant',
        userId,
      },
      { content: 'child', id: 'restore-child', parentId: 'restore-parent', role: 'user', userId },
    ]);

    await messageModel.restoreMessages([
      { childIds: ['restore-child'], id: 'restore-msg', parentId: 'restore-parent' },
    ]);

    expect((await row('restore-child')).parentId).toBe('restore-msg');
  });

  it('skips children of entries that were not restored', async () => {
    await serverDB.insert(messages).values({
      content: 'child',
      id: 'orphan-child',
      parentId: null,
      role: 'user',
      userId,
    });

    await expect(
      messageModel.restoreMessages([{ childIds: ['orphan-child'], id: 'missing-msg' }]),
    ).resolves.toEqual([]);
    expect((await row('orphan-child')).parentId).toBeNull();
  });

  it('restores the reachable entries of a batch that also contains unknown ids', async () => {
    await serverDB.insert(messages).values({
      content: 'trashed',
      deletedAt,
      id: 'batch-msg',
      isDeleted: true,
      role: 'user',
      userId,
    });

    await expect(
      messageModel.restoreMessages([
        { childIds: ['orphan-child'], id: 'missing-msg' },
        { id: 'batch-msg' },
      ]),
    ).resolves.toEqual(['batch-msg']);
    expect((await row('batch-msg')).isDeleted).toBeNull();
  });

  it('carries the branch selection of a re-parented child up to the restored row', async () => {
    await serverDB.insert(messages).values([
      { content: 'parent', id: 'rp', metadata: { activeBranchIndex: 0 }, role: 'user', userId },
      { content: 'a', id: 'ra', parentId: 'rp', role: 'assistant', userId },
      {
        content: 'b',
        createdAt: new Date('2026-01-01T00:00:05Z'),
        deletedAt,
        id: 'rm',
        isDeleted: true,
        parentId: 'rp',
        role: 'assistant',
        userId,
      },
    ]);

    await messageModel.restoreMessages([{ childIds: ['ra'], id: 'rm', parentId: 'rp' }]);

    expect((await row('rp')).metadata).toEqual({ activeBranchIndex: 0 });
  });

  it('leaves a branch selection that points at a sibling untouched', async () => {
    await serverDB.insert(messages).values([
      { content: 'parent', id: 'rp2', metadata: { activeBranchIndex: 0 }, role: 'user', userId },
      { content: 'sibling', id: 'rb', parentId: 'rp2', role: 'assistant', userId },
      {
        content: 'b',
        deletedAt,
        id: 'rm2',
        isDeleted: true,
        parentId: 'rp2',
        role: 'assistant',
        userId,
      },
      {
        content: 'child',
        deletedAt,
        id: 'ra2',
        isDeleted: true,
        parentId: 'rp2',
        role: 'user',
        userId,
      },
    ]);

    await messageModel.restoreMessages([{ childIds: ['ra2'], id: 'rm2', parentId: 'rp2' }]);

    expect((await row('rp2')).metadata).toEqual({ activeBranchIndex: 0 });
    expect((await row('ra2')).parentId).toBe('rm2');
  });
});

describe('MessageTrashMutations.findTrashedByIds', () => {
  it('returns an empty list for an empty id list', async () => {
    await expect(messageModel.findTrashedByIds([])).resolves.toEqual([]);
  });

  it('only returns trashed rows inside the caller scope', async () => {
    await serverDB.insert(messages).values([
      { content: 'trashed', deletedAt, id: 'ft-1', isDeleted: true, role: 'user', userId },
      { content: 'live', id: 'ft-2', role: 'user', userId },
      {
        content: 'other',
        deletedAt,
        id: 'ft-3',
        isDeleted: true,
        role: 'user',
        userId: otherUserId,
      },
    ]);

    const result = await messageModel.findTrashedByIds(['ft-1', 'ft-2', 'ft-3']);

    expect(result).toEqual([
      { agentId: null, id: 'ft-1', parentId: null, sessionId: null, topicId: null },
    ]);
  });
});

describe('MessageTrashMutations.softDeleteTopicless', () => {
  it('returns an empty list when no parent ids are given', async () => {
    await expect(messageModel.softDeleteTopicless({}, { deletedAt })).resolves.toEqual([]);
  });

  it('stamps topic-less rows of the given agents and sessions only', async () => {
    await serverDB.insert(agents).values([{ id: 'agent-a', title: 'Agent A', userId }]);
    await serverDB.insert(sessions).values([{ id: 'sess-a', userId }]);
    await serverDB.insert(messages).values([
      {
        agentId: 'agent-a',
        content: 'agentless',
        id: 'tl-1',
        role: 'user',
        userId,
      },
      { content: 'sessionless', id: 'tl-2', role: 'user', sessionId: 'sess-a', userId },
      {
        agentId: 'agent-a',
        content: 'in topic',
        id: 'tl-3',
        role: 'user',
        topicId: 'trash-topic',
        userId,
      },
      {
        agentId: 'agent-a',
        content: 'other user',
        id: 'tl-4',
        role: 'user',
        userId: otherUserId,
      },
    ]);

    const result = await messageModel.softDeleteTopicless(
      { agentIds: ['agent-a'], sessionIds: ['sess-a'] },
      { deletedAt },
    );

    expect(result.map((entry) => entry.id).sort()).toEqual(['tl-1', 'tl-2']);
    expect((await row('tl-1')).isDeleted).toBe(true);
    expect((await row('tl-2')).isDeleted).toBe(true);
    expect((await row('tl-3')).isDeleted).toBeNull();
    expect((await row('tl-4')).isDeleted).toBeNull();
  });

  it('supports filtering by a single parent kind', async () => {
    await serverDB.insert(agents).values([{ id: 'agent-b', title: 'Agent B', userId }]);
    await serverDB.insert(sessions).values([{ id: 'sess-b', userId }]);
    await serverDB.insert(messages).values([
      { agentId: 'agent-b', content: 'agentless', id: 'tl-5', role: 'user', userId },
      { content: 'sessionless', id: 'tl-6', role: 'user', sessionId: 'sess-b', userId },
    ]);

    const byAgent = await messageModel.softDeleteTopicless(
      { agentIds: ['agent-b'] },
      { deletedAt },
    );
    expect(byAgent.map((entry) => entry.id)).toEqual(['tl-5']);

    const bySession = await messageModel.softDeleteTopicless(
      { sessionIds: ['sess-b'] },
      { deletedAt },
    );
    expect(bySession.map((entry) => entry.id)).toEqual(['tl-6']);
  });
});

describe('MessageTrashMutations.purgeMessages', () => {
  it('is a no-op for an empty id list', async () => {
    await expect(messageModel.purgeMessages([])).resolves.toBeUndefined();
  });

  it('only purges trashed rows inside the caller scope', async () => {
    await serverDB.insert(messages).values([
      { content: 'trashed', deletedAt, id: 'pm-1', isDeleted: true, role: 'user', userId },
      { content: 'live', id: 'pm-2', role: 'user', userId },
      {
        content: 'other',
        deletedAt,
        id: 'pm-3',
        isDeleted: true,
        role: 'user',
        userId: otherUserId,
      },
    ]);

    await messageModel.purgeMessages(['pm-1', 'pm-2', 'pm-3']);

    await expect(row('pm-1')).resolves.toBeUndefined();
    await expect(row('pm-2')).resolves.toBeDefined();
    await expect(row('pm-3')).resolves.toBeDefined();
  });
});
