// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  agents,
  chatGroups,
  chatGroupsAgents,
  messages,
  topics,
  users,
  workspaces,
} from '@/database/schemas';

import { assertTaskOriginAccessible, assertTaskOriginPatchAllowed } from './originValidation';

const userId = 'task-origin-owner';
const otherUserId = 'task-origin-other';
const workspaceId = 'task-origin-ws';

// Module-level, like the database model tests: the first call migrates a
// fresh database, which can outlast a hook timeout on a loaded CI shard.
const db: LobeChatDatabase = await getTestDB();

const seedConversation = async (
  owner: string,
  key: string,
  options: { visibility?: 'private' | 'public'; workspaceId?: string } = {},
) => {
  const [agent] = await db
    .insert(agents)
    .values({
      id: `agt_${key}`,
      userId: owner,
      visibility: options.visibility ?? 'private',
      workspaceId: options.workspaceId,
    })
    .returning();
  const [topic] = await db
    .insert(topics)
    .values({
      agentId: agent.id,
      id: `tpc_${key}`,
      userId: owner,
      workspaceId: options.workspaceId,
    })
    .returning();
  const [message] = await db
    .insert(messages)
    .values({
      agentId: agent.id,
      content: 'hello',
      id: `msg_${key}`,
      role: 'user',
      topicId: topic.id,
      userId: owner,
      workspaceId: options.workspaceId,
    })
    .returning();
  return { agentId: agent.id, messageId: message.id, topicId: topic.id };
};

const cleanup = async () => {
  await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
};

describe('assertTaskOriginAccessible (real PostgreSQL)', () => {
  beforeEach(async () => {
    await cleanup();
    await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  });

  afterEach(cleanup);

  it("accepts the caller's own agent conversation", async () => {
    const own = await seedConversation(userId, 'own');

    await expect(assertTaskOriginAccessible(db, { userId }, own)).resolves.toBeUndefined();
  });

  it("rejects a topic owned by another user, even with the caller's own agent", async () => {
    const own = await seedConversation(userId, 'own');
    const foreign = await seedConversation(otherUserId, 'foreign');

    await expect(assertTaskOriginAccessible(db, { userId }, { ...foreign })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Origin conversation not found',
    });
    await expect(
      assertTaskOriginAccessible(
        db,
        { userId },
        { agentId: own.agentId, topicId: foreign.topicId },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("rejects a teammate's topic in the same workspace", async () => {
    await db
      .insert(workspaces)
      .values({ id: workspaceId, name: 'origin', primaryOwnerId: userId, slug: workspaceId });
    // A public agent is usable by every member, but the topic is still the
    // teammate's conversation — the bridge would wake their session.
    const teammate = await seedConversation(otherUserId, 'teammate', {
      visibility: 'public',
      workspaceId,
    });

    await expect(
      assertTaskOriginAccessible(db, { userId, workspaceId }, teammate),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      assertTaskOriginAccessible(db, { userId: otherUserId, workspaceId }, teammate),
    ).resolves.toBeUndefined();
  });

  it("rejects another user's private agent placed on the caller's topic", async () => {
    const own = await seedConversation(userId, 'own');
    const foreign = await seedConversation(otherUserId, 'foreign');

    await expect(
      assertTaskOriginAccessible(
        db,
        { userId },
        { agentId: foreign.agentId, topicId: own.topicId },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("rejects an agent that is not the topic's agent", async () => {
    const own = await seedConversation(userId, 'own');
    const second = await seedConversation(userId, 'second');

    await expect(
      assertTaskOriginAccessible(db, { userId }, { agentId: second.agentId, topicId: own.topicId }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Origin agent does not belong to the origin topic',
    });
  });

  it('accepts a member agent of a group topic', async () => {
    const member = await seedConversation(userId, 'member');
    const outsider = await seedConversation(userId, 'outsider');
    const [group] = await db
      .insert(chatGroups)
      .values({ id: 'grp_origin', title: 'Group', userId })
      .returning();
    await db
      .insert(chatGroupsAgents)
      .values({ agentId: member.agentId, chatGroupId: group.id, userId });
    const [groupTopic] = await db
      .insert(topics)
      .values({ groupId: group.id, id: 'tpc_group', userId })
      .returning();

    await expect(
      assertTaskOriginAccessible(
        db,
        { userId },
        { agentId: member.agentId, topicId: groupTopic.id },
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertTaskOriginAccessible(
        db,
        { userId },
        { agentId: outsider.agentId, topicId: groupTopic.id },
      ),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects a message that is not in the origin topic', async () => {
    const own = await seedConversation(userId, 'own');
    const second = await seedConversation(userId, 'second');

    await expect(
      assertTaskOriginAccessible(db, { userId }, { ...own, messageId: second.messageId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('requires agentId and topicId together', async () => {
    const own = await seedConversation(userId, 'own');

    await expect(
      assertTaskOriginAccessible(db, { userId }, { topicId: own.topicId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('assertTaskOriginPatchAllowed (real PostgreSQL)', () => {
  beforeEach(async () => {
    await cleanup();
    await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  });

  afterEach(cleanup);

  it('lets an unchanged or cleared origin through without re-checking', async () => {
    // A stored origin pointing at a conversation the caller cannot see, as
    // a teammate's tool-created task would carry.
    const foreign = await seedConversation(otherUserId, 'foreign');

    await expect(
      assertTaskOriginPatchAllowed(db, { userId }, foreign, { ...foreign, operationId: 'op_2' }),
    ).resolves.toEqual({ ...foreign, operationId: 'op_2' });
    await expect(
      assertTaskOriginPatchAllowed(db, { userId }, foreign, undefined),
    ).resolves.toBeUndefined();
  });

  it("rejects re-pointing an origin at another user's conversation", async () => {
    const own = await seedConversation(userId, 'own');
    const foreign = await seedConversation(otherUserId, 'foreign');

    await expect(assertTaskOriginPatchAllowed(db, { userId }, own, foreign)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      assertTaskOriginPatchAllowed(db, { userId }, undefined, foreign),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('stores an origin the bridge cannot deliver to as sent, like before', async () => {
    const partial = { topicId: 'tpc_x' };

    await expect(assertTaskOriginPatchAllowed(db, { userId }, undefined, partial)).resolves.toBe(
      partial,
    );
    await expect(assertTaskOriginPatchAllowed(db, { userId }, undefined, null)).resolves.toBeNull();
  });

  it('rejects a deliverable origin with non-string ids', async () => {
    await expect(
      assertTaskOriginPatchAllowed(db, { userId }, undefined, { agentId: 1, topicId: 'tpc_x' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
