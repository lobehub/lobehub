// @vitest-environment node
import { MessageGroupType } from '@lobechat/types';
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Real prune helper used by AiAgentService.execAgent in server-runtime regenerate.
import { pruneRegeneratedBranch } from '../../../../../../apps/server/src/services/aiAgent/pruneRegeneratedBranch';
import { getTestDB } from '../../../core/getTestDB';
import { messageGroups, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const userId = 'regenerate-prune-test-user';
const topicId = 'regenerate-prune-topic';

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

/**
 * End-to-end (real DB) verification of the server-runtime regenerate prune chain:
 * real MessageModel.query + real MessageModel.queryTopicMessageTree + the real
 * pruneRegeneratedBranch helper that execAgent uses. No mocks, no LLM.
 *
 * Tree: prior-u → prior-a → u1(anchor) → a1(old answer) → u2 → a2
 */
describe('server-runtime regenerate branch prune (real DB)', () => {
  const seedConversation = async () => {
    await serverDB.insert(messages).values([
      {
        id: 'prior-u',
        content: 'prior q',
        role: 'user',
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:00:00Z'),
      },
      {
        id: 'prior-a',
        content: 'prior a',
        role: 'assistant',
        parentId: 'prior-u',
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:01:00Z'),
      },
      {
        id: 'u1',
        content: 'the question',
        role: 'user',
        parentId: 'prior-a',
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:02:00Z'),
      },
      {
        id: 'a1',
        content: 'OLD answer',
        role: 'assistant',
        parentId: 'u1',
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:03:00Z'),
      },
      {
        id: 'u2',
        content: 'follow-up q',
        role: 'user',
        parentId: 'a1',
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:04:00Z'),
      },
      {
        id: 'a2',
        content: 'follow-up a',
        role: 'assistant',
        parentId: 'u2',
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:05:00Z'),
      },
    ]);
  };

  it('drops the uncompacted old branch (a1 + later turns) so history ends at the anchor', async () => {
    await seedConversation();

    const history = await messageModel.query({ topicId });
    const tree = await messageModel.queryTopicMessageTree({ topicId });

    const pruned = pruneRegeneratedBranch(history, tree, 'u1');

    expect(pruned.map((m) => m.id)).toEqual(['prior-u', 'prior-a', 'u1']);
  });

  it('drops a compressedGroup whose compacted members descend from the anchor (regression: /compact)', async () => {
    await seedConversation();

    // Compact the old branch [a1, u2, a2] into a compression group.
    await serverDB.insert(messageGroups).values({
      id: 'grp-old-branch',
      content: 'summary of old branch',
      type: MessageGroupType.Compression,
      topicId,
      userId,
      createdAt: new Date('2024-01-01T10:06:00Z'),
    });
    await serverDB
      .update(messages)
      .set({ messageGroupId: 'grp-old-branch' })
      .where(inArray(messages.id, ['a1', 'u2', 'a2']));

    const history = await messageModel.query({ topicId });
    const tree = await messageModel.queryTopicMessageTree({ topicId });

    // Premise: query hides the grouped messages and injects a synthetic
    // compressedGroup node that carries NO parentId.
    const groupNode = history.find((m) => m.role === 'compressedGroup') as any;
    expect(groupNode).toBeDefined();
    expect(groupNode.id).toBe('grp-old-branch');
    expect(groupNode.parentId ?? null).toBeNull();
    expect(history.map((m) => m.id)).toEqual(['prior-u', 'prior-a', 'u1', 'grp-old-branch']);

    // queryTopicMessageTree still exposes the hidden members with their parentIds.
    const treeIds = tree.map((r) => r.id).sort();
    expect(treeIds).toEqual(['a1', 'a2', 'prior-a', 'prior-u', 'u1', 'u2']);
    const a1Row = tree.find((r) => r.id === 'a1')!;
    expect(a1Row.parentId).toBe('u1');
    expect(a1Row.messageGroupId).toBe('grp-old-branch');

    // The fix: the compressedGroup summarizing the old branch is pruned.
    const pruned = pruneRegeneratedBranch(history, tree, 'u1');
    expect(pruned.map((m) => m.id)).toEqual(['prior-u', 'prior-a', 'u1']);
  });

  it('keeps a compressedGroup whose members precede the anchor (legitimate earlier context)', async () => {
    await seedConversation();

    // Compact the PRIOR turn [prior-u, prior-a] — this is context before the anchor.
    await serverDB.insert(messageGroups).values({
      id: 'grp-prior',
      content: 'summary of prior turns',
      type: MessageGroupType.Compression,
      topicId,
      userId,
      createdAt: new Date('2024-01-01T10:01:30Z'),
    });
    await serverDB
      .update(messages)
      .set({ messageGroupId: 'grp-prior' })
      .where(inArray(messages.id, ['prior-u', 'prior-a']));

    const history = await messageModel.query({ topicId });
    const tree = await messageModel.queryTopicMessageTree({ topicId });

    const pruned = pruneRegeneratedBranch(history, tree, 'u1');

    // Prior-turn group kept; the anchor's own old branch (a1, u2, a2) dropped.
    expect(pruned.map((m) => m.id)).toEqual(['grp-prior', 'u1']);
  });
});
