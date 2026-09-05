// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  DOCUMENT_FOLDER_TYPE,
  documentCommentMentions,
  documentComments,
  documentLikes,
  documents,
  files,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DOCUMENT_TRANSFER_FOREIGN_ROWS, DocumentModel } from '../document';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'doc-transfer-test-user';
const otherUserId = 'doc-transfer-test-other-user';
const wsId1 = 'doc-transfer-test-ws-1';
const wsId2 = 'doc-transfer-test-ws-2';

const createFolder = async (
  model: DocumentModel,
  filename: string,
  slug: string,
  parentId?: string,
) =>
  model.create({
    content: '',
    fileType: DOCUMENT_FOLDER_TYPE,
    filename,
    parentId,
    slug,
    source: '',
    sourceType: 'api',
    title: filename,
    totalCharCount: 0,
    totalLineCount: 0,
  });

const createPage = async (
  model: DocumentModel,
  filename: string,
  slug: string,
  parentId?: string,
) =>
  model.create({
    content: 'hello',
    fileType: 'page',
    filename,
    parentId,
    slug,
    source: '',
    sourceType: 'api',
    title: filename,
    totalCharCount: 5,
    totalLineCount: 1,
  });

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values([
    { id: wsId1, name: 'Doc WS 1', slug: 'doc-ws-1', primaryOwnerId: userId },
    { id: wsId2, name: 'Doc WS 2', slug: 'doc-ws-2', primaryOwnerId: userId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('DocumentModel.transferTo', () => {
  it('transfers a single page from personal to workspace', async () => {
    const model = new DocumentModel(serverDB, userId);
    const page = await createPage(model, 'My Page', 'my-page');

    const result = await model.transferTo(page.id, wsId1, userId);

    expect(result.documentIds).toEqual([page.id]);
    const updated = await serverDB.query.documents.findFirst({ where: eq(documents.id, page.id) });
    expect(updated?.workspaceId).toBe(wsId1);
    expect(updated?.userId).toBe(userId);
  });

  it('transfers a folder and all descendants', async () => {
    const model = new DocumentModel(serverDB, userId);
    const folder = await createFolder(model, 'Folder', 'folder-1');
    const child = await createPage(model, 'Child', 'child-1', folder.id);
    const subFolder = await createFolder(model, 'Sub', 'sub-1', folder.id);
    const grandchild = await createPage(model, 'Grand', 'grand-1', subFolder.id);

    const result = await model.transferTo(folder.id, wsId1, userId);

    expect(result.documentIds.sort()).toEqual(
      [folder.id, child.id, subFolder.id, grandchild.id].sort(),
    );

    const rows = await serverDB
      .select({ id: documents.id, workspaceId: documents.workspaceId })
      .from(documents)
      .where(inArray(documents.id, result.documentIds));
    for (const row of rows) expect(row.workspaceId).toBe(wsId1);
  });

  it('moves comments and mentions with a document subtree between workspaces', async () => {
    const ws1 = new DocumentModel(serverDB, userId, wsId1);
    const folder = await createFolder(ws1, 'Commented Folder', 'commented-folder');
    const child = await createPage(ws1, 'Commented Child', 'commented-child', folder.id);
    const commentTimestamp = new Date('2026-01-01T00:00:00.000Z');
    const createdComments = await serverDB
      .insert(documentComments)
      .values([
        {
          authorUserId: userId,
          clientId: 'transfer-root-comment',
          content: 'root comment',
          createdAt: commentTimestamp,
          documentId: folder.id,
          updatedAt: commentTimestamp,
          workspaceId: wsId1,
        },
        {
          authorUserId: userId,
          clientId: 'transfer-child-comment',
          content: 'child comment',
          createdAt: commentTimestamp,
          documentId: child.id,
          updatedAt: commentTimestamp,
          workspaceId: wsId1,
        },
      ])
      .returning({ id: documentComments.id });
    await serverDB.insert(documentCommentMentions).values(
      createdComments.map(({ id }) => ({
        commentId: id,
        mentionedUserId: userId,
        workspaceId: wsId1,
      })),
    );

    await ws1.transferTo(folder.id, wsId2, userId);

    const movedComments = await serverDB
      .select({ updatedAt: documentComments.updatedAt, workspaceId: documentComments.workspaceId })
      .from(documentComments)
      .where(inArray(documentComments.documentId, [folder.id, child.id]));
    expect(movedComments).toHaveLength(2);
    expect(movedComments.every(({ workspaceId }) => workspaceId === wsId2)).toBe(true);
    expect(
      movedComments.every(({ updatedAt }) => updatedAt.getTime() === commentTimestamp.getTime()),
    ).toBe(true);

    const movedMentions = await serverDB
      .select({ workspaceId: documentCommentMentions.workspaceId })
      .from(documentCommentMentions)
      .where(
        inArray(
          documentCommentMentions.commentId,
          createdComments.map(({ id }) => id),
        ),
      );
    expect(movedMentions).toHaveLength(2);
    expect(movedMentions.every(({ workspaceId }) => workspaceId === wsId2)).toBe(true);
  });

  it.each([
    { authorUserId: otherUserId, label: 'another member' },
    { authorUserId: null, label: 'a deleted author' },
  ])('treats comments from $label as foreign transfer rows', async ({ authorUserId, label }) => {
    const ws1 = new DocumentModel(serverDB, userId, wsId1);
    const page = await createPage(ws1, `Page by ${label}`, `foreign-comment-${label}`);
    await serverDB.insert(documentComments).values({
      authorUserId,
      clientId: `foreign-comment-${label}`,
      content: 'foreign comment',
      documentId: page.id,
      workspaceId: wsId1,
    });

    expect(await ws1.subtreeHasForeignRows(page.id)).toBe(true);
  });

  it("treats another member's like as a foreign transfer row, but not the caller's own", async () => {
    const ws1 = new DocumentModel(serverDB, userId, wsId1);
    const page = await createPage(ws1, 'Liked by teammate', 'foreign-like');

    await serverDB.insert(documentLikes).values({
      documentId: page.id,
      userId,
      workspaceId: wsId1,
    });
    expect(await ws1.subtreeHasForeignRows(page.id)).toBe(false);

    await serverDB.insert(documentLikes).values({
      documentId: page.id,
      userId: otherUserId,
      workspaceId: wsId1,
    });
    expect(await ws1.subtreeHasForeignRows(page.id)).toBe(true);
  });

  it('resolves slug conflicts by suffixing', async () => {
    const ws1 = new DocumentModel(serverDB, userId, wsId1);
    await createPage(ws1, 'Existing', 'shared-slug');

    const personal = new DocumentModel(serverDB, userId);
    const mine = await createPage(personal, 'Mine', 'shared-slug');

    await personal.transferTo(mine.id, wsId1, userId);

    const updated = await serverDB.query.documents.findFirst({ where: eq(documents.id, mine.id) });
    expect(updated?.slug).toBe('shared-slug-1');
    expect(updated?.workspaceId).toBe(wsId1);
  });

  it('moves files anchored to documents in the transferred subtree', async () => {
    const model = new DocumentModel(serverDB, userId);
    const folder = await createFolder(model, 'Folder', 'transfer-folder');

    await serverDB.insert(files).values({
      id: 'file-x',
      userId,
      fileType: 'image/png',
      name: 'pic.png',
      size: 10,
      url: 'http://x',
      parentId: folder.id,
    });

    await model.transferTo(folder.id, wsId1, userId);

    const [file] = await serverDB.select().from(files).where(eq(files.id, 'file-x'));
    expect(file.workspaceId).toBe(wsId1);
    expect(file.userId).toBe(userId);
  });

  it('rehomes likes with a cross-workspace transfer and drops them on personal transfer', async () => {
    const ws1 = new DocumentModel(serverDB, userId, wsId1);
    const page = await createPage(ws1, 'Liked page', 'liked-page');
    await serverDB.insert(documentLikes).values([
      { documentId: page.id, userId, workspaceId: wsId1 },
      { documentId: page.id, userId: otherUserId, workspaceId: wsId1 },
    ]);

    await ws1.transferTo(page.id, wsId2, userId);

    const moved = await serverDB
      .select({ userId: documentLikes.userId, workspaceId: documentLikes.workspaceId })
      .from(documentLikes)
      .where(eq(documentLikes.documentId, page.id));
    expect(moved).toHaveLength(2);
    for (const like of moved) expect(like.workspaceId).toBe(wsId2);

    await new DocumentModel(serverDB, userId, wsId2).transferTo(page.id, null, userId);

    expect(
      await serverDB.select().from(documentLikes).where(eq(documentLikes.documentId, page.id)),
    ).toHaveLength(0);
  });

  it('rechecks foreign rows inside the transfer transaction when forbidden', async () => {
    const ws1 = new DocumentModel(serverDB, userId, wsId1);
    const page = await createPage(ws1, 'Guarded page', 'guarded-page');

    // A clean own-content subtree transfers fine under the guard.
    await ws1.transferTo(page.id, wsId2, userId, undefined, { forbidForeignRows: true });

    // A teammate's like blocks a guarded transfer even without any preflight.
    const ws2 = new DocumentModel(serverDB, userId, wsId2);
    await serverDB.insert(documentLikes).values({
      documentId: page.id,
      userId: otherUserId,
      workspaceId: wsId2,
    });
    await expect(
      ws2.transferTo(page.id, wsId1, userId, undefined, { forbidForeignRows: true }),
    ).rejects.toThrow(DOCUMENT_TRANSFER_FOREIGN_ROWS);

    // The owner override (no flag) still moves the tree, likes included.
    await ws2.transferTo(page.id, wsId1, userId);
    const moved = await serverDB
      .select({ workspaceId: documentLikes.workspaceId })
      .from(documentLikes)
      .where(eq(documentLikes.documentId, page.id));
    expect(moved).toEqual([{ workspaceId: wsId1 }]);
  });

  it('transfers from workspace back to personal', async () => {
    const ws = new DocumentModel(serverDB, userId, wsId1);
    const page = await createPage(ws, 'In WS', 'in-ws');
    const [comment] = await serverDB
      .insert(documentComments)
      .values({
        authorUserId: userId,
        clientId: 'personal-transfer-comment',
        content: 'workspace-only comment',
        documentId: page.id,
        workspaceId: wsId1,
      })
      .returning({ id: documentComments.id });
    await serverDB.insert(documentCommentMentions).values({
      commentId: comment!.id,
      mentionedUserId: userId,
      workspaceId: wsId1,
    });

    await ws.transferTo(page.id, null, userId);

    const updated = await serverDB.query.documents.findFirst({ where: eq(documents.id, page.id) });
    expect(updated?.workspaceId).toBeNull();
    expect(
      await serverDB.select().from(documentComments).where(eq(documentComments.id, comment!.id)),
    ).toHaveLength(0);
    expect(
      await serverDB
        .select()
        .from(documentCommentMentions)
        .where(eq(documentCommentMentions.commentId, comment!.id)),
    ).toHaveLength(0);
  });
});

describe('DocumentModel.copyToWorkspace', () => {
  it('clones a single page into the target workspace with a fresh id', async () => {
    const model = new DocumentModel(serverDB, userId);
    const page = await createPage(model, 'Page', 'page-x');

    const { rootId } = await model.copyToWorkspace(page.id, wsId1, userId);

    expect(rootId).not.toBe(page.id);
    const clone = await serverDB.query.documents.findFirst({ where: eq(documents.id, rootId) });
    expect(clone?.workspaceId).toBe(wsId1);
    expect(clone?.title).toBe('Page');
    expect(clone?.content).toBe('hello');

    // Original untouched
    const original = await serverDB.query.documents.findFirst({ where: eq(documents.id, page.id) });
    expect(original?.workspaceId).toBeNull();
  });

  it('clones a folder + descendants preserving the parent topology', async () => {
    const model = new DocumentModel(serverDB, userId);
    const folder = await createFolder(model, 'Folder', 'copy-folder');
    const child = await createPage(model, 'Child', 'copy-child', folder.id);
    const sub = await createFolder(model, 'Sub', 'copy-sub', folder.id);
    const grand = await createPage(model, 'Grand', 'copy-grand', sub.id);

    const { rootId } = await model.copyToWorkspace(folder.id, wsId1, userId);

    const cloned = await serverDB.select().from(documents).where(eq(documents.workspaceId, wsId1));

    expect(cloned).toHaveLength(4);
    const root = cloned.find((d) => d.id === rootId)!;
    expect(root.parentId).toBeNull();

    const childrenOfRoot = cloned.filter((d) => d.parentId === rootId);
    expect(childrenOfRoot).toHaveLength(2);

    // Locate cloned sub folder, then grandchild beneath it
    const clonedSub = childrenOfRoot.find((d) => d.title === 'Sub')!;
    const clonedGrand = cloned.find((d) => d.parentId === clonedSub.id)!;
    expect(clonedGrand.title).toBe('Grand');

    // Verify originals untouched
    const originals = await serverDB
      .select()
      .from(documents)
      .where(inArray(documents.id, [folder.id, child.id, sub.id, grand.id]));
    for (const row of originals) expect(row.workspaceId).toBeNull();
  });

  it('reassigns slug on conflict in target scope', async () => {
    const ws1 = new DocumentModel(serverDB, userId, wsId1);
    await createPage(ws1, 'Existing', 'dupe-slug');

    const personal = new DocumentModel(serverDB, userId);
    const mine = await createPage(personal, 'Mine', 'dupe-slug');

    const { rootId } = await personal.copyToWorkspace(mine.id, wsId1, userId);
    const clone = await serverDB.query.documents.findFirst({ where: eq(documents.id, rootId) });
    expect(clone?.slug).toBe('dupe-slug-1');
  });
});
