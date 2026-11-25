// @vitest-environment node
import { MessageGroupType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messageGroups, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';
import { MAX_COMPRESSED_GROUP_MEMBERS } from '../../message/groupNodes';

const userId = 'compressed-group-page-test-user';
const otherUserId = 'compressed-group-page-other-user';
const topicId = 'compressed-group-page-topic';
const groupId = 'page-group';

const idOf = (i: number) => `pg-${String(i).padStart(4, '0')}`;

let messageModel: MessageModel;
let serverDB: LobeChatDatabase;

/** A group of `total` alternating user/assistant members, one second apart. */
const seedGroup = async (total: number) => {
  const base = Date.parse('2024-01-01T00:00:00Z');
  await serverDB.insert(messages).values(
    Array.from({ length: total }, (_, i) => ({
      content: `member ${i}`,
      createdAt: new Date(base + i * 1000),
      id: idOf(i),
      // Chain the members so `parse()` sees one conversation.
      parentId: i === 0 ? null : idOf(i - 1),
      role: i % 2 === 0 ? 'user' : 'assistant',
      topicId,
      userId,
    })),
  );
  await serverDB.insert(messageGroups).values({
    content: 'Summary',
    createdAt: new Date(base + total * 1000),
    id: groupId,
    topicId,
    type: MessageGroupType.Compression,
    userId,
  });
  await serverDB.update(messages).set({ messageGroupId: groupId });
};

beforeEach(async () => {
  serverDB = await getTestDB();

  await serverDB.delete(messageGroups);
  await serverDB.delete(messages);
  await serverDB.delete(topics);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values({ id: topicId, userId });

  messageModel = new MessageModel(serverDB, userId);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('MessageModel.queryCompressedGroupMembers', () => {
  it('pages the members the group node omitted, newest first, until the group start', async () => {
    // Two full pages plus a remainder past the node's own slice.
    const total = MAX_COMPRESSED_GROUP_MEMBERS * 3 + 10;
    await seedGroup(total);

    const [node] = (await messageModel.query({ topicId })).filter(
      (m) => m.role === 'compressedGroup',
    ) as any[];
    const nodeOmitted: string[] = node.compressedOmittedIds;
    // The node hydrates indices [610, 910); everything before is omitted.
    expect(nodeOmitted).toHaveLength(total - MAX_COMPRESSED_GROUP_MEMBERS);

    const first = await messageModel.queryCompressedGroupMembers({
      groupId,
      topicId,
      untilId: nodeOmitted.at(-1)!,
    });
    // The page ends right before the node's slice and starts on a user turn.
    expect(first.messages.at(-1)!.id).toBe(nodeOmitted.at(-1));
    expect(first.messages[0].role).toBe('user');
    expect(first.messages).toHaveLength(MAX_COMPRESSED_GROUP_MEMBERS);
    expect(first.omittedIds).toEqual(nodeOmitted.slice(0, -MAX_COMPRESSED_GROUP_MEMBERS));

    const second = await messageModel.queryCompressedGroupMembers({
      groupId,
      topicId,
      untilId: first.omittedIds.at(-1)!,
    });
    expect(second.messages.at(-1)!.id).toBe(first.omittedIds.at(-1));

    const last = await messageModel.queryCompressedGroupMembers({
      groupId,
      topicId,
      untilId: second.omittedIds.at(-1)!,
    });
    // Every member is now loaded exactly once, oldest first.
    expect(last.omittedIds).toEqual([]);
    expect(last.messages[0].id).toBe(idOf(0));
    const pagedIds = [...last.messages, ...second.messages, ...first.messages].map((m) => m.id);
    expect(pagedIds).toEqual(nodeOmitted);
  });

  it('returns an empty page for an id outside the group', async () => {
    await seedGroup(4);

    const page = await messageModel.queryCompressedGroupMembers({
      groupId,
      topicId,
      untilId: 'not-a-member',
    });

    expect(page).toEqual({ messages: [], omittedIds: [] });
  });

  it("does not read another user's compression group", async () => {
    await seedGroup(4);
    const otherModel = new MessageModel(serverDB, otherUserId);

    const page = await otherModel.queryCompressedGroupMembers({
      groupId,
      topicId,
      untilId: idOf(3),
    });

    expect(page).toEqual({ messages: [], omittedIds: [] });
  });

  it('returns an empty page when the group belongs to another topic', async () => {
    await seedGroup(4);

    const page = await messageModel.queryCompressedGroupMembers({
      groupId,
      topicId: 'another-topic',
      untilId: idOf(3),
    });

    expect(page).toEqual({ messages: [], omittedIds: [] });
  });
});
