// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { documentLikes, documents, workspaceMembers, workspaces } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { documentLikeRouter } from '../../documentLike';
import { cleanupTestUser, createTestUser } from './setup';

let testDB: LobeChatDatabase;
const notifyDocumentLiked = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const revokeDocumentLikeNotification = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => testDB) }));
vi.mock('@/business/server/document-like/notifyActivity', () => ({
  notifyDocumentLiked,
  revokeDocumentLikeNotification,
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

describe('documentLikeRouter integration', () => {
  let db: LobeChatDatabase;
  let documentId: string;
  let memberId: string;
  let outsiderId: string;
  let ownerId: string;
  let viewerId: string;
  let workspaceId: string;

  beforeEach(async () => {
    notifyDocumentLiked.mockClear();
    revokeDocumentLikeNotification.mockClear();
    publishResourceEvent.mockClear();
    db = await getTestDB();
    testDB = db;
    [ownerId, memberId, viewerId, outsiderId] = await Promise.all([
      createTestUser(db),
      createTestUser(db),
      createTestUser(db),
      createTestUser(db),
    ]);
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Document likes', primaryOwnerId: ownerId, slug: `dl-${ownerId}` })
      .returning();
    workspaceId = workspace.id;
    await db.insert(workspaceMembers).values([
      { role: 'owner', userId: ownerId, workspaceId },
      { role: 'member', userId: memberId, workspaceId },
      { role: 'viewer', userId: viewerId, workspaceId },
    ]);
    const [document] = await db
      .insert(documents)
      .values({
        fileType: 'custom',
        source: `document-${ownerId}`,
        sourceType: 'api',
        title: 'Likeable document',
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
    await Promise.all(
      [ownerId, memberId, viewerId, outsiderId].map((id) => cleanupTestUser(db, id)),
    );
  });

  it('lets members and viewers like, notifies the author once, and withdraws on unlike', async () => {
    const member = documentLikeRouter.createCaller(context(memberId, workspaceId));
    const viewer = documentLikeRouter.createCaller(context(viewerId, workspaceId));
    const owner = documentLikeRouter.createCaller(context(ownerId, workspaceId));

    await expect(member.summary({ documentId })).resolves.toEqual({
      liked: false,
      likers: [],
      total: 0,
    });

    const liked = await member.like({ documentId });
    expect(liked.liked).toBe(true);
    expect(liked.total).toBe(1);
    expect(liked.likers.map(({ id }) => id)).toEqual([memberId]);

    // Idempotent retry: no second notification or event.
    await member.like({ documentId });
    const viewerLiked = await viewer.like({ documentId });
    expect(viewerLiked.total).toBe(2);
    await flushAfterResponse();

    expect(notifyDocumentLiked).toHaveBeenCalledTimes(2);
    expect(notifyDocumentLiked).toHaveBeenCalledWith({
      actorUserId: memberId,
      documentId,
      recipientUserId: ownerId,
      workspaceId,
    });
    expect(publishResourceEvent).toHaveBeenCalledTimes(2);
    expect(publishResourceEvent).toHaveBeenCalledWith(
      { id: documentId, type: 'document' },
      { actorId: memberId, type: 'document.likesChanged' },
    );

    const ownerView = await owner.summary({ documentId });
    expect(ownerView.liked).toBe(false);
    expect(ownerView.total).toBe(2);

    const unliked = await member.unlike({ documentId });
    expect(unliked).toMatchObject({ liked: false, total: 1 });
    await member.unlike({ documentId });
    await flushAfterResponse();

    expect(revokeDocumentLikeNotification).toHaveBeenCalledTimes(1);
    expect(revokeDocumentLikeNotification).toHaveBeenCalledWith({
      actorUserId: memberId,
      documentId,
      recipientUserId: ownerId,
      workspaceId,
    });
    expect(publishResourceEvent).toHaveBeenCalledTimes(3);
  });

  it('does not notify the author for their own like', async () => {
    const owner = documentLikeRouter.createCaller(context(ownerId, workspaceId));
    await owner.like({ documentId });
    await owner.unlike({ documentId });
    await flushAfterResponse();

    expect(notifyDocumentLiked).not.toHaveBeenCalled();
    expect(revokeDocumentLikeNotification).not.toHaveBeenCalled();
    expect(publishResourceEvent).toHaveBeenCalledTimes(2);
  });

  it('does not notify an author who was removed from the workspace', async () => {
    await db
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(eq(workspaceMembers.userId, ownerId));

    const member = documentLikeRouter.createCaller(context(memberId, workspaceId));
    const liked = await member.like({ documentId });
    expect(liked.total).toBe(1);
    await flushAfterResponse();

    // The like lands, but the stale author id must not receive workspace
    // content (the notification carries the document title).
    expect(notifyDocumentLiked).not.toHaveBeenCalled();

    // Withdrawal is cleanup, not disclosure — it still reaches the inbox.
    await member.unlike({ documentId });
    await flushAfterResponse();
    expect(revokeDocumentLikeNotification).toHaveBeenCalledTimes(1);
  });

  it('rejects non-members and documents outside the workspace', async () => {
    const outsider = documentLikeRouter.createCaller(context(outsiderId, workspaceId));
    await expect(outsider.like({ documentId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(outsider.summary({ documentId })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const member = documentLikeRouter.createCaller(context(memberId, workspaceId));
    await expect(member.like({ documentId: 'missing-document' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    expect(await db.select().from(documentLikes)).toEqual([]);
    expect(notifyDocumentLiked).not.toHaveBeenCalled();
  });
});
