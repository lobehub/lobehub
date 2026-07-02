// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { DOCUMENT_FOLDER_TYPE, documents, files, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DocumentModel } from '../document';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'doc-transfer-test-user';
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
  await serverDB.insert(users).values([{ id: userId }]);
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

  it('transfers from workspace back to personal', async () => {
    const ws = new DocumentModel(serverDB, userId, wsId1);
    const page = await createPage(ws, 'In WS', 'in-ws');

    await ws.transferTo(page.id, null, userId);

    const updated = await serverDB.query.documents.findFirst({ where: eq(documents.id, page.id) });
    expect(updated?.workspaceId).toBeNull();
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
