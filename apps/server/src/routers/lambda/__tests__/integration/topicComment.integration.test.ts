// @vitest-environment node
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
import { and, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResourcePermissionModel } from '@/database/models/resourcePermission';

import { assertTopicCommentReadAccess } from '../../_helpers/topicCommentAccess';
import { topicCommentRouter } from '../../topicComment';
import { cleanupTestUser, createTestUser } from './setup';

let testDB: LobeChatDatabase;
const notifyTopicCommentActivity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const notifyTopicCommentModeration = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const publishResourceEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => testDB) }));
vi.mock('@/business/server/topic-comment/notifyActivity', () => ({
  notifyTopicCommentActivity,
}));
vi.mock('@/business/server/topic-comment/notifyModeration', () => ({
  notifyTopicCommentModeration,
}));
vi.mock('@/server/services/resourceEvents', () => ({ publishResourceEvent }));
// Post-response work is async (recipient re-authorization runs its own
// queries), so tests must drain it before asserting on the delivery slots.
const afterResponseTasks = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  after: (work: () => unknown) => void afterResponseTasks.push(Promise.resolve().then(work)),
}));

const flushAfterResponse = async () => {
  while (afterResponseTasks.length > 0) await Promise.all(afterResponseTasks.splice(0));
};

const context = (userId: string, workspaceId?: string) => ({
  jwtPayload: { userId },
  userId,
  workspaceId,
});

describe('topicCommentRouter integration', () => {
  let adminId: string;
  let db: LobeChatDatabase;
  let memberId: string;
  let ownerId: string;
  let topicId: string;
  let viewerId: string;
  let workspaceId: string;

  beforeEach(async () => {
    notifyTopicCommentActivity.mockReset();
    notifyTopicCommentActivity.mockResolvedValue(undefined);
    notifyTopicCommentModeration.mockReset();
    notifyTopicCommentModeration.mockResolvedValue(undefined);
    publishResourceEvent.mockReset();
    publishResourceEvent.mockResolvedValue(undefined);
    db = await getTestDB();
    testDB = db;
    [ownerId, adminId, memberId, viewerId] = await Promise.all([
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
      { role: 'admin', userId: adminId, workspaceId },
      { role: 'member', userId: memberId, workspaceId },
      { role: 'viewer', userId: viewerId, workspaceId },
    ]);
    const [topic] = await db
      .insert(topics)
      .values({ title: 'Comments', userId: ownerId, workspaceId })
      .returning();
    topicId = topic.id;
  });

  afterEach(async () => {
    await flushAfterResponse();
    await db.execute(
      sql`ALTER TABLE workspace_audit_logs DROP CONSTRAINT IF EXISTS reject_topic_comment_audit`,
    );
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await Promise.all([ownerId, adminId, memberId, viewerId].map((id) => cleanupTestUser(db, id)));
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

  it('publishes invalidation only for committed create, update and delete changes', async () => {
    const member = topicCommentRouter.createCaller(context(memberId, workspaceId));
    const input = { clientId: 'realtime-1', content: 'created', topicId };
    const created = await member.create(input);
    await flushAfterResponse();
    expect(publishResourceEvent).toHaveBeenCalledOnce();
    expect(publishResourceEvent).toHaveBeenLastCalledWith(
      { id: topicId, type: 'topic' },
      { actorId: memberId, type: 'topic.commentsChanged' },
    );

    await member.create(input);
    await flushAfterResponse();
    expect(publishResourceEvent).toHaveBeenCalledOnce();

    await member.update({ content: 'updated', id: created.comment.id });
    await flushAfterResponse();
    expect(publishResourceEvent).toHaveBeenCalledTimes(2);
    await member.delete({ id: created.comment.id });
    await flushAfterResponse();
    expect(publishResourceEvent).toHaveBeenCalledTimes(3);
  });

  it('rejects realtime access to missing and cross-workspace topics', async () => {
    await expect(
      assertTopicCommentReadAccess({
        db,
        hideExistence: true,
        topicId,
        userId: memberId,
        workspaceId,
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertTopicCommentReadAccess({
        db,
        hideExistence: true,
        topicId: 'missing-topic',
        userId: memberId,
        workspaceId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const [foreignWorkspace] = await db
      .insert(workspaces)
      .values({ name: 'Foreign comments', primaryOwnerId: ownerId, slug: `foreign-${ownerId}` })
      .returning();
    try {
      const [foreignTopic] = await db
        .insert(topics)
        .values({ title: 'Foreign topic', userId: ownerId, workspaceId: foreignWorkspace.id })
        .returning();
      await expect(
        assertTopicCommentReadAccess({
          db,
          hideExistence: true,
          topicId: foreignTopic.id,
          userId: memberId,
          workspaceId,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, foreignWorkspace.id));
    }
  });

  it('enforces target access after conversation access changes', async () => {
    const agentId = 'topic-comment-view-only-agent';
    const agentTopicId = 'topic-comment-view-only-topic';
    await db.insert(agents).values({
      id: agentId,
      title: 'View-only Agent',
      userId: adminId,
      visibility: 'public',
      workspaceId,
    });
    await db.insert(topics).values({
      agentId,
      id: agentTopicId,
      title: 'View-only Topic',
      userId: adminId,
      workspaceId,
    });

    const member = topicCommentRouter.createCaller(context(memberId, workspaceId));
    const owner = topicCommentRouter.createCaller(context(ownerId, workspaceId));
    const created = await member.create({
      clientId: 'member-before-view-only',
      content: 'original',
      topicId: agentTopicId,
    });
    await new ResourcePermissionModel(db, workspaceId).setAccessLevel(
      'agent',
      agentId,
      'view',
      adminId,
    );

    await expect(member.get({ id: created.comment.id })).resolves.toMatchObject({
      canDelete: false,
      canEdit: false,
      content: 'original',
    });
    await expect(
      member.update({ content: 'denied', id: created.comment.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(member.delete({ id: created.comment.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const [stored] = await db
      .select({
        content: topicComments.content,
        deletedAt: topicComments.deletedAt,
        moderatedAt: topicComments.moderatedAt,
      })
      .from(topicComments)
      .where(eq(topicComments.id, created.comment.id));
    expect(stored).toMatchObject({ content: 'original', deletedAt: null, moderatedAt: null });

    await expect(owner.delete({ id: created.comment.id })).resolves.toMatchObject({
      mode: 'moderated',
    });
    await db.update(agents).set({ visibility: 'private' }).where(eq(agents.id, agentId));
    notifyTopicCommentModeration.mockClear();
    await expect(owner.restore({ id: created.comment.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const [stillModerated] = await db
      .select({ moderatedAt: topicComments.moderatedAt })
      .from(topicComments)
      .where(eq(topicComments.id, created.comment.id));
    expect(stillModerated.moderatedAt).not.toBeNull();
    await flushAfterResponse();
    expect(notifyTopicCommentModeration).not.toHaveBeenCalled();
  });

  it('denies private topic and message targets without leaking inaccessible rows', async () => {
    const privateAgentId = 'topic-comment-private-agent';
    const privateTopicId = 'topic-comment-private-topic';
    const privateMessageId = 'topic-comment-private-message';
    await db.insert(agents).values({
      id: privateAgentId,
      title: 'Private Agent',
      userId: memberId,
      visibility: 'private',
      workspaceId,
    });
    await db.insert(topics).values({
      agentId: privateAgentId,
      id: privateTopicId,
      title: 'Private Topic',
      userId: memberId,
      workspaceId,
    });
    await db.insert(messages).values({
      agentId: privateAgentId,
      content: 'private anchor',
      id: privateMessageId,
      role: 'assistant',
      topicId: privateTopicId,
      userId: memberId,
      workspaceId,
    });

    const admin = topicCommentRouter.createCaller(context(adminId, workspaceId));
    const member = topicCommentRouter.createCaller(context(memberId, workspaceId));
    const owner = topicCommentRouter.createCaller(context(ownerId, workspaceId));

    await expect(
      admin.create({ clientId: 'private-topic', content: 'denied', topicId: privateTopicId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      admin.create({
        clientId: 'private-message',
        content: 'denied',
        messageId: privateMessageId,
        topicId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      admin.create({ clientId: 'missing-topic', content: 'denied', topicId: 'missing-topic' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      admin.create({
        clientId: 'missing-message',
        content: 'denied',
        messageId: 'missing-message',
        topicId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const privateRoot = await member.create({
      clientId: 'private-member',
      content: 'allowed',
      topicId: privateTopicId,
    });
    await member.create({
      clientId: 'private-member-reply',
      content: 'allowed reply',
      parentCommentId: privateRoot.comment.id,
      topicId: privateTopicId,
    });
    await expect(member.get({ id: privateRoot.comment.id })).resolves.toMatchObject({
      topicId: privateTopicId,
    });

    await expect(admin.get({ id: privateRoot.comment.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      admin.listReplies({ rootCommentId: privateRoot.comment.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(admin.listThreads({ topicId: privateTopicId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(admin.summary({ topicId: privateTopicId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(owner.delete({ id: privateRoot.comment.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const [storedPrivateRoot] = await db
      .select({ moderatedAt: topicComments.moderatedAt })
      .from(topicComments)
      .where(eq(topicComments.id, privateRoot.comment.id));
    expect(storedPrivateRoot.moderatedAt).toBeNull();
    await flushAfterResponse();
    expect(notifyTopicCommentModeration).not.toHaveBeenCalled();
  });

  it('notifies topic participants, message owners, reply authors, and mentions once', async () => {
    const member = topicCommentRouter.createCaller(context(memberId, workspaceId));
    const owner = topicCommentRouter.createCaller(context(ownerId, workspaceId));

    const root = await owner.create({ clientId: 'owner-root', content: 'root', topicId });
    await flushAfterResponse();
    expect(notifyTopicCommentActivity).not.toHaveBeenCalled();

    const adminMessageId = 'topic-comment-admin-message';
    await db.insert(messages).values([
      {
        content: 'admin participated',
        id: adminMessageId,
        role: 'user',
        topicId,
        userId: adminId,
        workspaceId,
      },
      {
        content: 'admin participated again',
        id: 'topic-comment-admin-message-2',
        role: 'assistant',
        topicId,
        userId: adminId,
        workspaceId,
      },
      {
        content: 'comment actor participated',
        id: 'topic-comment-member-message',
        role: 'user',
        topicId,
        userId: memberId,
        workspaceId,
      },
    ]);

    const topLevel = await member.create({
      clientId: 'member-top-level',
      content: 'comment',
      topicId,
    });
    await flushAfterResponse();
    expect(notifyTopicCommentActivity).toHaveBeenLastCalledWith({
      actorUserId: memberId,
      commentId: topLevel.comment.id,
      recipients: [
        { kind: 'commented', userId: ownerId },
        { kind: 'commented', userId: adminId },
      ],
      rootCommentId: topLevel.comment.id,
      topicId,
      workspaceId,
    });

    await member.create({ clientId: 'member-top-level', content: 'retry', topicId });
    await flushAfterResponse();
    expect(notifyTopicCommentActivity).toHaveBeenCalledTimes(1);

    const anchored = await member.create({
      clientId: 'member-anchored',
      content: 'comment on a message with a mention',
      editorData: {
        root: {
          children: [{ metadata: { id: viewerId, type: 'member' }, type: 'mention' }],
        },
      },
      messageId: adminMessageId,
      topicId,
    });
    await flushAfterResponse();
    expect(notifyTopicCommentActivity).toHaveBeenLastCalledWith({
      actorUserId: memberId,
      commentId: anchored.comment.id,
      recipients: [
        { kind: 'commentedOnMessage', userId: adminId },
        { kind: 'mentioned', userId: viewerId },
      ],
      rootCommentId: anchored.comment.id,
      topicId,
      workspaceId,
    });

    const reply = await member.create({
      clientId: 'member-reply',
      content: 'reply with mentions',
      editorData: {
        root: {
          children: [
            { metadata: { id: ownerId, type: 'member' }, type: 'mention' },
            { metadata: { id: adminId, type: 'member' }, type: 'mention' },
            { metadata: { id: memberId, type: 'member' }, type: 'mention' },
          ],
        },
      },
      parentCommentId: root.comment.id,
      topicId,
    });
    await flushAfterResponse();
    expect(notifyTopicCommentActivity).toHaveBeenLastCalledWith({
      actorUserId: memberId,
      commentId: reply.comment.id,
      recipients: [
        { kind: 'mentioned', userId: ownerId },
        { kind: 'mentioned', userId: adminId },
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
    await flushAfterResponse();
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
    await flushAfterResponse();
    expect(notifyTopicCommentActivity).not.toHaveBeenCalled();
  });

  it('skips activity recipients without current access to the topic', async () => {
    const member = topicCommentRouter.createCaller(context(memberId, workspaceId));
    const owner = topicCommentRouter.createCaller(context(ownerId, workspaceId));
    const privateAgentId = 'topic-comment-notify-private-agent';
    const privateTopicId = 'topic-comment-notify-private-topic';
    await db.insert(agents).values({
      id: privateAgentId,
      title: 'Private Agent',
      userId: memberId,
      visibility: 'private',
      workspaceId,
    });
    await db.insert(topics).values({
      agentId: privateAgentId,
      id: privateTopicId,
      title: 'Private Topic',
      userId: memberId,
      workspaceId,
    });

    await member.create({
      clientId: 'private-mention',
      content: 'mentioning someone who cannot open this conversation',
      editorData: {
        root: { children: [{ metadata: { id: adminId, type: 'member' }, type: 'mention' }] },
      },
      topicId: privateTopicId,
    });

    await flushAfterResponse();
    expect(notifyTopicCommentActivity).not.toHaveBeenCalled();

    const root = await member.create({ clientId: 'former-member-root', content: 'root', topicId });
    await flushAfterResponse();
    notifyTopicCommentActivity.mockClear();

    await db
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, memberId)),
      );
    await owner.create({
      clientId: 'reply-to-former-member',
      content: 'reply',
      parentCommentId: root.comment.id,
      topicId,
    });

    await flushAfterResponse();
    expect(notifyTopicCommentActivity).not.toHaveBeenCalled();
  });

  it('lets an owner recoverably remove and restore another member comment', async () => {
    const member = topicCommentRouter.createCaller(context(memberId, workspaceId));
    const owner = topicCommentRouter.createCaller(context(ownerId, workspaceId));
    const viewer = topicCommentRouter.createCaller(context(viewerId, workspaceId));
    const created = await member.create({
      clientId: 'member-moderated',
      content: 'retained secret',
      editorData: { root: { version: 1 } },
      topicId,
    });
    await flushAfterResponse();
    expect(publishResourceEvent).toHaveBeenCalledTimes(1);

    const removed = await owner.delete({ id: created.comment.id });
    await flushAfterResponse();
    expect(publishResourceEvent).toHaveBeenCalledTimes(2);
    expect(publishResourceEvent).toHaveBeenLastCalledWith(
      { id: topicId, type: 'topic' },
      { actorId: '', type: 'topic.commentsChanged' },
    );

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

    const restored = await owner.restore({ id: created.comment.id });
    await flushAfterResponse();
    expect(publishResourceEvent).toHaveBeenCalledTimes(3);
    expect(publishResourceEvent).toHaveBeenLastCalledWith(
      { id: topicId, type: 'topic' },
      { actorId: '', type: 'topic.commentsChanged' },
    );

    expect(restored).toMatchObject({
      canRestore: false,
      content: 'retained secret',
      moderatedAt: null,
      moderationExpiresAt: null,
    });
    await flushAfterResponse();
    expect(notifyTopicCommentModeration).toHaveBeenNthCalledWith(1, {
      authorUserId: memberId,
      commentId: created.comment.id,
      event: 'removed',
      eventId: expect.any(String),
      rootCommentId: created.comment.id,
      topicId,
      workspaceId,
    });
    await flushAfterResponse();
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
          userId: ownerId,
          workspaceId,
        }),
      ]),
    );
  });

  it('rolls back moderation when the audit write fails', async () => {
    const member = topicCommentRouter.createCaller(context(memberId, workspaceId));
    const owner = topicCommentRouter.createCaller(context(ownerId, workspaceId));
    const created = await member.create({
      clientId: 'member-moderation-audit-failure',
      content: 'must remain visible',
      topicId,
    });
    await db.execute(sql`
      ALTER TABLE workspace_audit_logs
      ADD CONSTRAINT reject_topic_comment_audit
      CHECK (resource_type <> 'topic_comment')
    `);

    await expect(owner.delete({ id: created.comment.id })).rejects.toThrow();

    const [stored] = await db
      .select({ moderatedAt: topicComments.moderatedAt })
      .from(topicComments)
      .where(eq(topicComments.id, created.comment.id));
    expect(stored.moderatedAt).toBeNull();
    await flushAfterResponse();
    expect(notifyTopicCommentModeration).not.toHaveBeenCalled();
  });

  it('rolls back moderation restore when the audit write fails', async () => {
    const member = topicCommentRouter.createCaller(context(memberId, workspaceId));
    const owner = topicCommentRouter.createCaller(context(ownerId, workspaceId));
    const created = await member.create({
      clientId: 'member-restore-audit-failure',
      content: 'must remain moderated',
      topicId,
    });
    const moderatedAt = new Date();
    await db
      .update(topicComments)
      .set({
        moderatedAt,
        moderatedByUserId: ownerId,
        moderationExpiresAt: new Date(moderatedAt.getTime() + 60_000),
      })
      .where(eq(topicComments.id, created.comment.id));
    await db.execute(sql`
      ALTER TABLE workspace_audit_logs
      ADD CONSTRAINT reject_topic_comment_audit
      CHECK (resource_type <> 'topic_comment')
    `);

    await expect(owner.restore({ id: created.comment.id })).rejects.toThrow();

    const [stored] = await db
      .select({ moderatedAt: topicComments.moderatedAt })
      .from(topicComments)
      .where(eq(topicComments.id, created.comment.id));
    expect(stored.moderatedAt).not.toBeNull();
    await flushAfterResponse();
    expect(notifyTopicCommentModeration).not.toHaveBeenCalled();
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
