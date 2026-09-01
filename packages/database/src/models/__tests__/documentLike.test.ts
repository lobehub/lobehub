// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documentLikes, documents, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  DOCUMENT_LIKE_DOCUMENT_NOT_FOUND,
  DOCUMENT_LIKE_WORKSPACE_REQUIRED,
  DocumentLikeModel,
} from '../documentLike';

const serverDB: LobeChatDatabase = await getTestDB();

const authorId = 'document-like-author';
const memberId = 'document-like-member';
const outsiderId = 'document-like-outsider';
const workspaceId = 'document-like-workspace';
const otherWorkspaceId = 'document-like-other-workspace';
const documentId = 'document-like-document';
const foreignDocumentId = 'document-like-foreign-document';

const authorModel = new DocumentLikeModel(serverDB, authorId, workspaceId);
const memberModel = new DocumentLikeModel(serverDB, memberId, workspaceId);
const outsiderModel = new DocumentLikeModel(serverDB, outsiderId, otherWorkspaceId);

const createDocument = (id: string, userId: string, targetWorkspaceId: string | null) =>
  serverDB.insert(documents).values({
    fileType: 'custom',
    id,
    source: id,
    sourceType: 'api',
    totalCharCount: 0,
    totalLineCount: 0,
    userId,
    workspaceId: targetWorkspaceId,
  });

const cleanup = async () => {
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
};

beforeEach(async () => {
  await cleanup();
  await serverDB
    .insert(users)
    .values([
      { avatar: 'https://example.com/author.png', fullName: 'Author', id: authorId },
      { id: memberId, username: 'member' },
      { id: outsiderId },
    ]);
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'Likes', primaryOwnerId: authorId, slug: workspaceId },
    { id: otherWorkspaceId, name: 'Other', primaryOwnerId: outsiderId, slug: otherWorkspaceId },
  ]);
  await Promise.all([
    createDocument(documentId, authorId, workspaceId),
    createDocument(foreignDocumentId, outsiderId, otherWorkspaceId),
  ]);
});

afterEach(cleanup);

describe('DocumentLikeModel', () => {
  it('requires workspace scope and rejects documents outside the current workspace', async () => {
    const personalModel = new DocumentLikeModel(serverDB, memberId);
    await expect(personalModel.like(documentId)).rejects.toThrow(DOCUMENT_LIKE_WORKSPACE_REQUIRED);
    await expect(outsiderModel.like(documentId)).rejects.toThrow(DOCUMENT_LIKE_DOCUMENT_NOT_FOUND);
    await expect(memberModel.summary(foreignDocumentId)).rejects.toThrow(
      DOCUMENT_LIKE_DOCUMENT_NOT_FOUND,
    );
    await expect(memberModel.unlike('missing-document')).rejects.toThrow(
      DOCUMENT_LIKE_DOCUMENT_NOT_FOUND,
    );
  });

  it('likes idempotently, reports the document author, and stamps the workspace', async () => {
    await expect(memberModel.like(documentId)).resolves.toEqual({
      created: true,
      documentAuthorUserId: authorId,
    });
    await expect(memberModel.like(documentId)).resolves.toEqual({
      created: false,
      documentAuthorUserId: authorId,
    });

    const rows = await serverDB
      .select()
      .from(documentLikes)
      .where(eq(documentLikes.documentId, documentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: memberId, workspaceId });
  });

  it('summarizes total, current-user state, and newest likers first', async () => {
    await expect(memberModel.summary(documentId)).resolves.toEqual({
      liked: false,
      likers: [],
      total: 0,
    });

    await memberModel.like(documentId);
    await authorModel.like(documentId);

    const memberView = await memberModel.summary(documentId);
    expect(memberView.total).toBe(2);
    expect(memberView.liked).toBe(true);
    expect(memberView.likers.map(({ id }) => id)).toEqual([authorId, memberId]);
    expect(memberView.likers[0]).toEqual({
      avatar: 'https://example.com/author.png',
      fullName: 'Author',
      id: authorId,
      username: null,
    });

    const outsiderView = await new DocumentLikeModel(serverDB, outsiderId, workspaceId).summary(
      documentId,
    );
    expect(outsiderView.liked).toBe(false);
    expect(outsiderView.total).toBe(2);
  });

  it('unlikes only the current user and reports whether a like was removed', async () => {
    await memberModel.like(documentId);
    await authorModel.like(documentId);

    await expect(memberModel.unlike(documentId)).resolves.toEqual({
      documentAuthorUserId: authorId,
      removed: true,
    });
    await expect(memberModel.unlike(documentId)).resolves.toEqual({
      documentAuthorUserId: authorId,
      removed: false,
    });

    const summary = await authorModel.summary(documentId);
    expect(summary.total).toBe(1);
    expect(summary.liked).toBe(true);
  });

  it('drops likes when the document is deleted', async () => {
    await memberModel.like(documentId);
    await serverDB.delete(documents).where(eq(documents.id, documentId));

    const rows = await serverDB.select().from(documentLikes);
    expect(rows).toHaveLength(0);
  });
});
