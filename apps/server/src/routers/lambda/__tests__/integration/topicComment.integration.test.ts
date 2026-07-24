// @vitest-environment node
import { WORKSPACE_SYSTEM_ROLES } from '@lobechat/const/rbac';
import type { LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  messages,
  topicComments,
  topics,
  workspaceAuditLogs,
  workspaceMembers,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RbacModel } from '@/database/models/rbac';
import { seedWorkspaceRoles } from '@/database/utils/seedWorkspaceRoles';

import { topicCommentRouter } from '../../topicComment';
import { cleanupTestUser, createTestUser } from './setup';

let testDB: LobeChatDatabase;
const notifyTopicCommentActivity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const notifyTopicCommentModeration = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => testDB) }));
vi.mock('@/business/server/topic-comment/notifyActivity', () => ({
  notifyTopicCommentActivity,
}));
vi.mock('@/business/server/topic-comment/notifyModeration', () => ({
  notifyTopicCommentModeration,
}));
vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  after: (work: () => unknown) => void work(),
}));

const context = (userId: string, workspaceId?: string) => ({
  jwtPayload: { userId },
  userId,
  workspaceId,
});

describe('topicCommentRouter integration', () => {
  let db: LobeChatDatabase;
  let memberId: string;
  let ownerId: string;
  let secondOwnerId: string;
  let topicId: string;
  let viewerId: string;
  let workspaceId: string;

  beforeEach(async () => {
    notifyTopicCommentActivity.mockReset();
    notifyTopicCommentActivity.mockResolvedValue(undefined);
    notifyTopicCommentModeration.mockReset();
    notifyTopicCommentModeration.mockResolvedValue(undefined);
    db = await getTestDB();
    testDB = db;
    [ownerId, secondOwnerId, memberId, viewerId] = await Promise.all([
      createTestUser(db),
      createTestUser(db),
      createTestUser(db),
      createTestUser(db),
    ]);
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Comment test', primaryOwnerId: ownerId, slug: `comment-${ownerId}` })
      .returning();
    workspaceId = workspace.id;
    await db.insert(workspaceMembers).values([
      { role: 'owner', userId: ownerId, workspaceId },
      { role: 'owner', userId: secondOwnerId, workspaceId },
      { role: 'member', userId: memberId, workspaceId },
      { role: 'viewer', userId: viewerId, workspaceId },
    ]);
    await seedWorkspaceRoles(db, workspaceId);
    const rbac = new RbacModel(db, ownerId);
    await Promise.all([
      rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId: secondOwnerId,
        workspaceId,
      }),
      rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.OWNER,
        userId: ownerId,
        workspaceId,
      }),
      rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.MEMBER,
        userId: memberId,
        workspaceId,
      }),
      rbac.assignWorkspaceRole({
        roleName: WORKSPACE_SYSTEM_ROLES.VIEWER,
        userId: viewerId,
        workspaceId,
      }),
    ]);
    const [topic] = await db
      .insert(topics)
      .values({ title: 'Comments', userId: ownerId, workspaceId })
      .returning();
    topicId = topic.id;
  });

  afterEach(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await Promise.all(
      [ownerId, secondOwnerId, memberId, viewerId].map((id) => cleanupTestUser(db, id)),
    );
  });

  it('enforces member/owner/viewer mutation permissions', async () => {
    const member = topicCommentRouter.createCaller(context(memberId, workspaceId));
    const owner = topicCommentRouter.createCaller(context(ownerId, workspaceId));
    const viewer = topicCommentRouter.createCaller(context(viewerId, workspaceId));
    const created = await member.create({ clientId: 'member-1', content: 'hello', topicId });
    expect(created.comment.author.status).toBe('active');
    expect((await member.update({ content: 'edited', id: created.comment.id })).content).toBe(
      'edited',
    );
    await expect(
      viewer.create({ clientId: 'viewer-1', content: 'no', topicId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await viewer.get({ id: created.comment.id })).canEdit).toBe(false);
    await expect(viewer.delete({ id: created.comment.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect((await owner.delete({ id: created.comment.id })).mode).toBe('moderated');
  });

  it('denies private topic and message targets without leaking inaccessible rows', async () => {
    const privateAgentId = 'topic-comment-private-agent';
    const privateTopicId = 'topic-comment-private-topic';
    const privateMessageId = 'topic-comment-private-message';
    await db.insert(agents).values({
      id: privateAgentId,
      title: 'Private Agent',
      userId: ownerId,
      visibility: 'private',
      workspaceId,
    });
    await db.insert(topics).values({
      agentId: privateAgentId,
      id: privateTopicId,
      title: 'Private Topic',
      userId: ownerId,
      workspaceId,
    });
    await db.insert(messages).values({
      agentId: privateAgentId,
      content: 'private anchor',
      id: privateMessageId,
      role: 'assistant',
      topicId: privateTopicId,
      userId: ownerId,
      workspaceId,
    });

    const member = topicCommentRouter.createCaller(context(memberId, workspaceId));
    const owner = topicCommentRouter.createCaller(context(ownerId, workspaceId));

    await expect(
      member.create({ clientId: 'private-topic', content: 'denied', topicId: privateTopicId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      member.create({
        clientId: 'private-message',
        content: 'denied',
        messageId: privateMessageId,
        topicId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      member.create({ clientId: 'missing-topic', content: 'denied', topicId: 'missing-topic' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      member.create({
        clientId: 'missing-message',
        content: 'denied',
        messageId: 'missing-message',
        topicId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(
      owner.create({ clientId: 'private-owner', content: 'allowed', topicId: privateTopicId }),
    ).resolves.toMatchObject({ comment: { topicId: privateTopicId } });
  });

  it('notifies topic owners, reply authors, and newly mentioned active members once', async () => {
    const member = topicCommentRouter.createCaller(context(memberId, workspaceId));
    const owner = topicCommentRouter.createCaller(context(ownerId, workspaceId));

    const root = await owner.create({ clientId: 'owner-root', content: 'root', topicId });
    expect(notifyTopicCommentActivity).not.toHaveBeenCalled();

    const topLevel = await member.create({
      clientId: 'member-top-level',
      content: 'comment',
      topicId,
    });
    expect(notifyTopicCommentActivity).toHaveBeenLastCalledWith({
      actorUserId: memberId,
      commentId: topLevel.comment.id,
      recipients: [{ kind: 'commented', userId: ownerId }],
      rootCommentId: topLevel.comment.id,
      topicId,
      workspaceId,
    });

    await member.create({ clientId: 'member-top-level', content: 'retry', topicId });
    expect(notifyTopicCommentActivity).toHaveBeenCalledTimes(1);

    const reply = await member.create({
      clientId: 'member-reply',
      content: 'reply with mentions',
      editorData: {
        root: {
          children: [
            { metadata: { id: ownerId, type: 'member' }, type: 'mention' },
            { metadata: { id: secondOwnerId, type: 'member' }, type: 'mention' },
            { metadata: { id: memberId, type: 'member' }, type: 'mention' },
          ],
        },
      },
      parentCommentId: root.comment.id,
      topicId,
    });
    expect(notifyTopicCommentActivity).toHaveBeenLastCalledWith({
      actorUserId: memberId,
      commentId: reply.comment.id,
      recipients: [
        { kind: 'mentioned', userId: ownerId },
        { kind: 'mentioned', userId: secondOwnerId },
      ],
      rootCommentId: root.comment.id,
      topicId,
      workspaceId,
    });

    notifyTopicCommentActivity.mockClear();
    await member.update({
      editorData: {
        root: {
          children: [{ metadata: { id: viewerId, type: 'member' }, type: 'mention' }],
        },
      },
      id: topLevel.comment.id,
    });
    expect(notifyTopicCommentActivity).toHaveBeenCalledWith({
      actorUserId: memberId,
      commentId: topLevel.comment.id,
      recipients: [{ kind: 'mentioned', userId: viewerId }],
      rootCommentId: topLevel.comment.id,
      topicId,
      workspaceId,
    });

    notifyTopicCommentActivity.mockClear();
    await member.update({
      editorData: {
        root: {
          children: [{ metadata: { id: viewerId, type: 'member' }, type: 'mention' }],
        },
      },
      id: topLevel.comment.id,
    });
    expect(notifyTopicCommentActivity).not.toHaveBeenCalled();
  });

  it('lets an owner recoverably remove and restore another member comment', async () => {
    const member = topicCommentRouter.createCaller(context(memberId, workspaceId));
    const owner = topicCommentRouter.createCaller(context(ownerId, workspaceId));
    const secondOwner = topicCommentRouter.createCaller(context(secondOwnerId, workspaceId));
    const viewer = topicCommentRouter.createCaller(context(viewerId, workspaceId));
    const created = await member.create({
      clientId: 'member-moderated',
      content: 'retained secret',
      editorData: { root: { version: 1 } },
      topicId,
    });

    const removed = await owner.delete({ id: created.comment.id });

    expect(removed).toMatchObject({
      comment: {
        canRestore: true,
        content: 'retained secret',
        moderatedAt: expect.any(Date),
        moderationIsOwn: false,
      },
      mode: 'moderated',
    });
    expect(removed.comment).not.toHaveProperty('moderatedByUserId');
    await expect(viewer.get({ id: created.comment.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await member.get({ id: created.comment.id })).toMatchObject({
      canRestore: false,
      content: '',
      editorData: null,
      moderationIsOwn: true,
    });
    await expect(member.restore({ id: created.comment.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const restored = await secondOwner.restore({ id: created.comment.id });

    expect(restored).toMatchObject({
      canRestore: false,
      content: 'retained secret',
      moderatedAt: null,
      moderationExpiresAt: null,
    });
    expect(notifyTopicCommentModeration).toHaveBeenNthCalledWith(1, {
      authorUserId: memberId,
      commentId: created.comment.id,
      event: 'removed',
      eventId: expect.any(String),
      rootCommentId: created.comment.id,
      topicId,
      workspaceId,
    });
    expect(notifyTopicCommentModeration).toHaveBeenNthCalledWith(2, {
      authorUserId: memberId,
      commentId: created.comment.id,
      event: 'restored',
      eventId: expect.any(String),
      rootCommentId: created.comment.id,
      topicId,
      workspaceId,
    });
    const auditLogs = await db
      .select()
      .from(workspaceAuditLogs)
      .where(eq(workspaceAuditLogs.resourceId, created.comment.id));
    expect(auditLogs).toHaveLength(2);
    expect(auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'resource.deleted', userId: ownerId, workspaceId }),
        expect.objectContaining({
          action: 'resource.restored',
          userId: secondOwnerId,
          workspaceId,
        }),
      ]),
    );
  });

  it('keeps an owner self-delete irreversible and preserves moderated threads for other viewers', async () => {
    const member = topicCommentRouter.createCaller(context(memberId, workspaceId));
    const owner = topicCommentRouter.createCaller(context(ownerId, workspaceId));
    const viewer = topicCommentRouter.createCaller(context(viewerId, workspaceId));
    const own = await owner.create({ clientId: 'owner-self-delete', content: 'mine', topicId });
    expect(await owner.delete({ id: own.comment.id })).toEqual({ mode: 'hard' });

    const root = await member.create({
      clientId: 'moderated-root',
      content: 'private root body',
      topicId,
    });
    await owner.create({
      clientId: 'active-reply',
      content: 'reply survives',
      parentCommentId: root.comment.id,
      topicId,
    });
    await owner.delete({ id: root.comment.id });

    const threads = await viewer.listThreads({ topicId });
    expect(threads.items).toEqual([
      expect.objectContaining({
        replyCount: 1,
        root: expect.objectContaining({
          content: '',
          editorData: null,
          id: root.comment.id,
          moderationIsOwn: false,
        }),
      }),
    ]);
    expect(threads.items[0].root).not.toHaveProperty('moderatedByUserId');

    const [stored] = await db
      .select()
      .from(topicComments)
      .where(eq(topicComments.id, root.comment.id));
    expect(stored.content).toBe('private root body');
  });

  it('requires workspace and validates comment content', async () => {
    await expect(
      topicCommentRouter.createCaller(context(memberId)).summary({ topicId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const member = topicCommentRouter.createCaller(context(memberId, workspaceId));
    await expect(
      member.create({ clientId: 'empty', content: '   ', topicId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      member.create({ clientId: 'long', content: 'x'.repeat(10_001), topicId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('lists root threads newest first across pages', async () => {
    const member = topicCommentRouter.createCaller(context(memberId, workspaceId));
    await member.create({ clientId: 'first', content: 'first', topicId });
    await member.create({ clientId: 'second', content: 'second', topicId });
    const first = await member.listThreads({ limit: 1, topicId });
    expect(first.items[0].root.content).toBe('second');
    const second = await member.listThreads({ cursor: first.nextCursor!, limit: 1, topicId });
    expect(second.items[0].root.content).toBe('first');
  });
});
