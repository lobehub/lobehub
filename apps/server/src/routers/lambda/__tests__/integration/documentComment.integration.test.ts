// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  documentCommentMentions,
  documentComments,
  documents,
  workspaceMembers,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RbacModel } from '@/database/models/rbac';

import { documentCommentRouter } from '../../documentComment';
import { cleanupTestUser, createTestUser } from './setup';

let testDB: LobeChatDatabase;
const notifyDocumentCommentActivity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => testDB) }));
vi.mock('@/business/server/document-comment/notifyActivity', () => ({
  notifyDocumentCommentActivity,
}));
const publishResourceEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/server/services/resourceEvents', () => ({ publishResourceEvent }));
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

const mentionEditorData = (...userIds: string[]) => ({
  root: {
    children: userIds.map((id) => ({
      children: [],
      metadata: { id, type: 'member' },
      type: 'mention',
    })),
    type: 'root',
  },
});

describe('documentCommentRouter integration', () => {
  const getWorkspaceUsersPermissions = vi.spyOn(RbacModel, 'getWorkspaceUsersPermissions');
  let adminId: string;
  let db: LobeChatDatabase;
  let documentId: string;
  let memberId: string;
  let ownerId: string;
  let viewerId: string;
  let workspaceId: string;

  beforeEach(async () => {
    getWorkspaceUsersPermissions.mockClear();
    notifyDocumentCommentActivity.mockReset();
    notifyDocumentCommentActivity.mockResolvedValue(undefined);
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
      .values({ name: 'Document comments', primaryOwnerId: ownerId, slug: `dc-${ownerId}` })
      .returning();
    workspaceId = workspace.id;
    await db.insert(workspaceMembers).values([
      { role: 'owner', userId: ownerId, workspaceId },
      { role: 'admin', userId: adminId, workspaceId },
      { role: 'member', userId: memberId, workspaceId },
      { role: 'viewer', userId: viewerId, workspaceId },
    ]);
    const [document] = await db
      .insert(documents)
      .values({
        fileType: 'custom',
        source: `document-${ownerId}`,
        sourceType: 'api',
        title: 'Commentable document',
        totalCharCount: 0,
        totalLineCount: 0,
        userId: ownerId,
        workspaceId,
      })
      .returning();
    documentId = document.id;
  });

  afterEach(async () => {
    await flushAfterResponse();
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await Promise.all([ownerId, adminId, memberId, viewerId].map((id) => cleanupTestUser(db, id)));
  });

  afterAll(() => getWorkspaceUsersPermissions.mockRestore());

  it('allows members to discuss, viewers to read, and admins to delete any comment', async () => {
    const admin = documentCommentRouter.createCaller(context(adminId, workspaceId));
    const member = documentCommentRouter.createCaller(context(memberId, workspaceId));
    const viewer = documentCommentRouter.createCaller(context(viewerId, workspaceId));
    const created = await member.create({
      clientId: 'member-comment',
      content: 'hello',
      documentId,
    });
    await flushAfterResponse();

    expect(notifyDocumentCommentActivity).toHaveBeenCalledWith({
      actorUserId: memberId,
      commentId: created.comment.id,
      documentId,
      kind: 'commented',
      recipientUserId: ownerId,
      rootCommentId: created.comment.id,
      workspaceId,
    });

    expect(created.comment).toMatchObject({
      author: { id: memberId, status: 'active' },
      canDelete: true,
      canEdit: true,
    });
    await expect(
      viewer.create({ clientId: 'viewer-comment', content: 'no', documentId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await viewer.listThreads({ documentId })).items[0].root).toMatchObject({
      canDelete: false,
      canEdit: false,
      content: 'hello',
    });
    expect((await admin.delete({ id: created.comment.id })).mode).toBe('hard');
  });

  it('serves one comment by id with a live reply count for roots', async () => {
    const member = documentCommentRouter.createCaller(context(memberId, workspaceId));
    const viewer = documentCommentRouter.createCaller(context(viewerId, workspaceId));
    const root = (await member.create({ clientId: 'get-root', content: 'root', documentId }))
      .comment;
    const reply = (
      await member.create({
        clientId: 'get-reply',
        content: 'reply',
        documentId,
        parentCommentId: root.id,
      })
    ).comment;
    await flushAfterResponse();

    expect(await viewer.get({ id: root.id })).toMatchObject({
      canEdit: false,
      content: 'root',
      replyCount: 1,
    });
    expect(await member.get({ id: reply.id })).toMatchObject({
      canEdit: true,
      parentCommentId: root.id,
      replyCount: 0,
    });

    expect((await member.delete({ id: reply.id })).mode).toBe('hard');
    await expect(member.get({ id: reply.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await member.get({ id: root.id })).toMatchObject({ replyCount: 0 });
  });

  it('preserves a root tombstone while replies remain and keeps counts consistent', async () => {
    const member = documentCommentRouter.createCaller(context(memberId, workspaceId));
    const owner = documentCommentRouter.createCaller(context(ownerId, workspaceId));
    const root = await member.create({ clientId: 'root', content: 'root', documentId });
    const reply = await owner.create({
      clientId: 'reply',
      content: 'reply',
      documentId,
      parentCommentId: root.comment.id,
    });
    const nestedReply = await member.create({
      clientId: 'nested-reply',
      content: 'nested reply',
      documentId,
      parentCommentId: reply.comment.id,
    });

    expect(nestedReply.comment).toMatchObject({
      parentCommentId: root.comment.id,
      replyTo: { author: { id: ownerId }, id: reply.comment.id },
      replyToCommentId: reply.comment.id,
    });
    expect((await owner.listReplies({ rootCommentId: root.comment.id })).items).toMatchObject([
      { id: reply.comment.id, replyTo: null },
      { id: nestedReply.comment.id, replyTo: { author: { id: ownerId } } },
    ]);

    expect((await member.delete({ id: root.comment.id })).mode).toBe('soft');
    expect(await owner.summary({ documentId })).toEqual({ total: 2 });
    expect((await owner.listThreads({ documentId })).items[0]).toMatchObject({
      replyCount: 2,
      root: { content: '', deletedAt: expect.any(Date) },
    });
  });

  it('does not expose a private document to another workspace member', async () => {
    await db.update(documents).set({ visibility: 'private' }).where(eq(documents.id, documentId));
    const owner = documentCommentRouter.createCaller(context(ownerId, workspaceId));
    const member = documentCommentRouter.createCaller(context(memberId, workspaceId));

    await expect(owner.summary({ documentId })).resolves.toEqual({ total: 0 });
    await expect(member.summary({ documentId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await db.select().from(documentComments)).toEqual([]);
  });

  it('accepts attachment-only comments and rejects incomplete uploads', async () => {
    const member = documentCommentRouter.createCaller(context(memberId, workspaceId));
    const completedFile = {
      root: {
        children: [
          {
            fileUrl: 'https://files.example.com/report.pdf',
            name: 'report.pdf',
            status: 'uploaded',
            type: 'file',
          },
        ],
        type: 'root',
      },
    };
    const created = await member.create({
      clientId: 'attachment-only',
      content: '',
      documentId,
      editorData: completedFile,
    });
    expect(created.comment.content).toBe('');

    const textComment = await member.create({
      clientId: 'replace-with-attachment',
      content: 'replace me',
      documentId,
    });
    const updated = await member.update({
      content: '',
      editorData: completedFile,
      id: textComment.comment.id,
    });
    expect(updated.content).toBe('');

    await expect(
      member.create({
        clientId: 'pending-attachment',
        content: 'do not publish yet',
        documentId,
        editorData: {
          root: {
            children: [{ name: 'large.zip', status: 'pending', type: 'file' }],
            type: 'root',
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      member.create({ clientId: 'empty-comment', content: '', documentId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('publishes one realtime invalidation after each committed mutation', async () => {
    const member = documentCommentRouter.createCaller(context(memberId, workspaceId));
    const created = await member.create({ clientId: 'event-root', content: 'root', documentId });
    await flushAfterResponse();

    expect(publishResourceEvent).toHaveBeenCalledOnce();
    expect(publishResourceEvent).toHaveBeenLastCalledWith(
      { id: documentId, type: 'document' },
      {
        actorId: memberId,
        data: { rootCommentId: created.comment.id },
        type: 'document.commentsChanged',
      },
    );

    await member.create({ clientId: 'event-root', content: 'duplicate', documentId });
    await flushAfterResponse();
    expect(publishResourceEvent).toHaveBeenCalledOnce();

    await member.update({ content: 'updated', id: created.comment.id });
    await flushAfterResponse();
    expect(publishResourceEvent).toHaveBeenCalledTimes(2);

    await member.delete({ id: created.comment.id });
    await flushAfterResponse();
    expect(publishResourceEvent).toHaveBeenCalledTimes(3);
  });

  it('notifies the direct reply target once and skips self or stale-access recipients', async () => {
    const member = documentCommentRouter.createCaller(context(memberId, workspaceId));
    const owner = documentCommentRouter.createCaller(context(ownerId, workspaceId));

    const root = await owner.create({ clientId: 'owner-root', content: 'root', documentId });
    await flushAfterResponse();
    expect(notifyDocumentCommentActivity).not.toHaveBeenCalled();

    const reply = await member.create({
      clientId: 'member-reply',
      content: 'reply',
      documentId,
      parentCommentId: root.comment.id,
    });
    await flushAfterResponse();
    expect(notifyDocumentCommentActivity).toHaveBeenLastCalledWith({
      actorUserId: memberId,
      commentId: reply.comment.id,
      documentId,
      kind: 'replied',
      recipientUserId: ownerId,
      rootCommentId: root.comment.id,
      workspaceId,
    });

    await member.create({
      clientId: 'member-reply',
      content: 'duplicate retry',
      documentId,
      parentCommentId: root.comment.id,
    });
    await flushAfterResponse();
    expect(notifyDocumentCommentActivity).toHaveBeenCalledTimes(1);

    await db.update(documents).set({ visibility: 'private' }).where(eq(documents.id, documentId));
    const privateReply = await owner.create({
      clientId: 'private-reply',
      content: 'no leaked notification',
      documentId,
      parentCommentId: reply.comment.id,
    });
    await flushAfterResponse();
    expect(privateReply.comment.replyTo?.author.id).toBe(memberId);
    expect(notifyDocumentCommentActivity).toHaveBeenCalledTimes(1);
  });

  it('fans a reply out to the direct target and the other thread participants', async () => {
    const owner = documentCommentRouter.createCaller(context(ownerId, workspaceId));
    const member = documentCommentRouter.createCaller(context(memberId, workspaceId));
    const admin = documentCommentRouter.createCaller(context(adminId, workspaceId));

    const root = await owner.create({ clientId: 'owner-root', content: 'root', documentId });
    const memberReply = await member.create({
      clientId: 'member-reply',
      content: 'reply',
      documentId,
      parentCommentId: root.comment.id,
    });
    await flushAfterResponse();
    notifyDocumentCommentActivity.mockClear();

    // Admin replies to the member's reply: member is the direct target, the
    // root author only gets the thread ping.
    const adminReply = await admin.create({
      clientId: 'admin-reply',
      content: 'nested',
      documentId,
      parentCommentId: memberReply.comment.id,
    });
    await flushAfterResponse();
    expect(notifyDocumentCommentActivity).toHaveBeenCalledTimes(2);
    expect(notifyDocumentCommentActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        commentId: adminReply.comment.id,
        kind: 'replied',
        recipientUserId: memberId,
        rootCommentId: root.comment.id,
      }),
    );
    expect(notifyDocumentCommentActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        commentId: adminReply.comment.id,
        kind: 'thread',
        recipientUserId: ownerId,
        rootCommentId: root.comment.id,
      }),
    );

    // Root author replies to their own root: never self-notified, every other
    // participant hears about the new activity.
    notifyDocumentCommentActivity.mockClear();
    await owner.create({
      clientId: 'owner-reply',
      content: 'thanks both',
      documentId,
      parentCommentId: root.comment.id,
    });
    await flushAfterResponse();
    expect(notifyDocumentCommentActivity).toHaveBeenCalledTimes(2);
    expect(
      notifyDocumentCommentActivity.mock.calls
        .map(([params]) => [params.recipientUserId, params.kind])
        .sort(),
    ).toEqual(
      [
        [adminId, 'thread'],
        [memberId, 'thread'],
      ].sort(),
    );
  });

  it('notifies valid mentions once, prefers mention copy, and only sends newly added mentions', async () => {
    const member = documentCommentRouter.createCaller(context(memberId, workspaceId));
    const created = await member.create({
      clientId: 'mentions',
      content: '@owner @viewer @self @outsider',
      documentId,
      editorData: mentionEditorData(ownerId, viewerId, memberId, 'outside-workspace'),
    });
    await flushAfterResponse();

    const recipientAccessLookups = getWorkspaceUsersPermissions.mock.calls.filter(
      ([{ userIds }]) => userIds.includes(ownerId) || userIds.includes(viewerId),
    );
    expect(recipientAccessLookups).toHaveLength(1);
    expect(recipientAccessLookups[0][0].userIds).toEqual(
      expect.arrayContaining([ownerId, viewerId]),
    );
    expect(notifyDocumentCommentActivity).toHaveBeenCalledTimes(2);
    expect(notifyDocumentCommentActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        commentId: created.comment.id,
        kind: 'mentioned',
        recipientUserId: ownerId,
      }),
    );
    expect(notifyDocumentCommentActivity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'mentioned', recipientUserId: viewerId }),
    );
    expect(
      (
        await db
          .select({ mentionedUserId: documentCommentMentions.mentionedUserId })
          .from(documentCommentMentions)
          .where(eq(documentCommentMentions.commentId, created.comment.id))
      )
        .map(({ mentionedUserId }) => mentionedUserId)
        .sort(),
    ).toEqual([ownerId, viewerId].sort());

    notifyDocumentCommentActivity.mockClear();
    await member.update({
      content: '@owner @viewer @admin',
      editorData: mentionEditorData(ownerId, viewerId, adminId),
      id: created.comment.id,
    });
    await flushAfterResponse();
    expect(notifyDocumentCommentActivity).toHaveBeenCalledTimes(1);
    expect(notifyDocumentCommentActivity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'mentioned', recipientUserId: adminId }),
    );
    expect(
      (
        await db
          .select({ mentionedUserId: documentCommentMentions.mentionedUserId })
          .from(documentCommentMentions)
          .where(eq(documentCommentMentions.commentId, created.comment.id))
      )
        .map(({ mentionedUserId }) => mentionedUserId)
        .sort(),
    ).toEqual([adminId, ownerId, viewerId].sort());

    notifyDocumentCommentActivity.mockClear();
    await member.update({
      editorData: mentionEditorData(ownerId, viewerId, adminId),
      id: created.comment.id,
    });
    await flushAfterResponse();
    expect(notifyDocumentCommentActivity).not.toHaveBeenCalled();
  });
});
