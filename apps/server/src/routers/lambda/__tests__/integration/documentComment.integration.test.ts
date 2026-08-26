// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  documentComments,
  documents,
  workspaceMembers,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { documentCommentRouter } from '../../documentComment';
import { cleanupTestUser, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => testDB) }));

const context = (userId: string, workspaceId?: string) => ({
  jwtPayload: { userId },
  userId,
  workspaceId,
});

describe('documentCommentRouter integration', () => {
  let adminId: string;
  let db: LobeChatDatabase;
  let documentId: string;
  let memberId: string;
  let ownerId: string;
  let viewerId: string;
  let workspaceId: string;

  beforeEach(async () => {
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
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await Promise.all([ownerId, adminId, memberId, viewerId].map((id) => cleanupTestUser(db, id)));
  });

  it('allows members to discuss, viewers to read, and admins to delete any comment', async () => {
    const admin = documentCommentRouter.createCaller(context(adminId, workspaceId));
    const member = documentCommentRouter.createCaller(context(memberId, workspaceId));
    const viewer = documentCommentRouter.createCaller(context(viewerId, workspaceId));
    const created = await member.create({
      clientId: 'member-comment',
      content: 'hello',
      documentId,
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
});
