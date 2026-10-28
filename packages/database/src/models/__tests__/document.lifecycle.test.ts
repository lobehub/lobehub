// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documents, files, knowledgeBases, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DocumentModel } from '../document';
import { FileModel } from '../file';
import { KnowledgeBaseModel } from '../knowledgeBase';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'document-lifecycle-test-user';
const otherUserId = 'document-lifecycle-test-user-2';

const documentModel = new DocumentModel(serverDB, userId);
const otherDocumentModel = new DocumentModel(serverDB, otherUserId);

const fileModel = new FileModel(serverDB, userId);
const otherFileModel = new FileModel(serverDB, otherUserId);

const knowledgeBaseModel = new KnowledgeBaseModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(files);
  await serverDB.delete(documents);
  await serverDB.delete(knowledgeBases);
  await serverDB.delete(users);
});

const createFile = (model: FileModel, name: string, params: Record<string, any> = {}) =>
  model.create({
    fileType: 'text/plain',
    name,
    size: 100,
    url: `https://example.com/${name}`,
    ...params,
  });

const createDocument = (model: DocumentModel, params: Record<string, any> = {}) =>
  model.create({
    content: '',
    fileType: 'text/plain',
    source: 'https://example.com/lifecycle.txt',
    sourceType: 'file',
    totalCharCount: 0,
    totalLineCount: 0,
    ...params,
  });

const readDocument = async (id: string) => {
  const [row] = await serverDB.select().from(documents).where(eq(documents.id, id));
  return row;
};

describe('DocumentModel.query', () => {
  it('drops documents filed into an excluded knowledge base', async () => {
    const knowledgeBase = await knowledgeBaseModel.create({ name: 'restricted' });
    const filed = await createDocument(documentModel, {
      knowledgeBaseId: knowledgeBase.id,
      title: 'Filed',
    });
    const standalone = await createDocument(documentModel, { title: 'Standalone' });

    const result = await documentModel.query({ excludeKnowledgeBaseIds: [knowledgeBase.id] });

    expect(result.items.map((item) => item.id)).toEqual([standalone.id]);
    expect(result.total).toBe(1);
    expect(filed.id).not.toBe(standalone.id);
  });
});

describe('DocumentModel.findByIds', () => {
  it('short-circuits an empty id list without touching the database', async () => {
    await createDocument(documentModel, { title: 'present' });

    await expect(documentModel.findByIds([])).resolves.toEqual([]);
  });

  it('drops ids owned by another user', async () => {
    const mine = await createDocument(documentModel, { title: 'mine' });
    const theirs = await createDocument(otherDocumentModel, { title: 'theirs' });

    const rows = await documentModel.findByIds([mine.id, theirs.id]);

    expect(rows.map((row) => row.id)).toEqual([mine.id]);
  });
});

describe('DocumentModel.setVisibility', () => {
  it('mirrors a promotion onto the paired file row', async () => {
    const file = await createFile(fileModel, 'promote.txt', { visibility: 'private' });
    const document = await createDocument(documentModel, {
      fileId: file.id,
      title: 'Promote me',
      visibility: 'private',
    });

    await expect(documentModel.publishToWorkspace(document.id)).resolves.toEqual({
      documentIds: [document.id],
    });

    expect((await readDocument(document.id)).visibility).toBe('public');

    const [updatedFile] = await serverDB.select().from(files).where(eq(files.id, file.id));

    expect(updatedFile.visibility).toBe('public');
  });

  it('takes a published page back to private', async () => {
    const file = await createFile(fileModel, 'demote.txt');
    const document = await createDocument(documentModel, {
      fileId: file.id,
      title: 'Demote me',
      visibility: 'public',
    });

    await documentModel.setVisibility(document.id, 'private');

    expect((await readDocument(document.id)).visibility).toBe('private');

    const [updatedFile] = await serverDB.select().from(files).where(eq(files.id, file.id));

    expect(updatedFile.visibility).toBe('private');
  });

  it('refuses a document outside the caller scope', async () => {
    const theirs = await createDocument(otherDocumentModel, {
      title: 'theirs',
      visibility: 'private',
    });

    await expect(documentModel.setVisibility(theirs.id, 'public')).rejects.toThrow(
      'Document not found',
    );

    expect((await readDocument(theirs.id)).visibility).toBe('private');
  });

  it('refuses an unknown document id', async () => {
    await expect(documentModel.setVisibility('document-does-not-exist', 'public')).rejects.toThrow(
      'Document not found',
    );
  });
});

describe('DocumentModel.syncFromFile', () => {
  it('returns an empty list and keeps the row when the patch is empty', async () => {
    const file = await createFile(fileModel, 'untouched.txt');
    const document = await createDocument(documentModel, {
      fileId: file.id,
      filename: 'untouched.txt',
      title: 'Untouched',
    });

    await expect(documentModel.syncFromFile(file.id, {})).resolves.toEqual([]);

    const row = await readDocument(document.id);

    expect(row.title).toBe('Untouched');
    expect(row.filename).toBe('untouched.txt');
  });

  it('mirrors a renamed file onto title and filename', async () => {
    const file = await createFile(fileModel, 'before.txt');
    const document = await createDocument(documentModel, {
      fileId: file.id,
      filename: 'before.txt',
      title: 'Before',
    });

    await documentModel.syncFromFile(file.id, { name: 'after.md' });

    const row = await readDocument(document.id);

    expect(row.title).toBe('after.md');
    expect(row.filename).toBe('after.md');
  });

  it('re-homes a mirrored document under the file parent', async () => {
    const folder = await documentModel.findOrCreateFolder('inbox');
    const file = await createFile(fileModel, 'move.txt');
    const document = await createDocument(documentModel, {
      fileId: file.id,
      filename: 'move.txt',
      title: 'Move me',
    });

    await documentModel.syncFromFile(file.id, { parentId: folder.id });

    expect((await readDocument(document.id)).parentId).toBe(folder.id);
  });

  it('leaves documents owned by another user untouched', async () => {
    const otherFile = await createFile(otherFileModel, 'foreign.txt');
    const theirs = await createDocument(otherDocumentModel, {
      fileId: otherFile.id,
      filename: 'foreign.txt',
      title: 'Foreign',
    });

    await expect(
      documentModel.syncFromFile(otherFile.id, { name: 'hijacked.txt' }),
    ).resolves.toEqual([]);

    const row = await readDocument(theirs.id);

    expect(row.title).toBe('Foreign');
    expect(row.filename).toBe('foreign.txt');
  });
});

describe('DocumentModel.subtreeHasForeignRows', () => {
  it('reports no foreign rows for a document outside the caller scope', async () => {
    await expect(documentModel.subtreeHasForeignRows('document-does-not-exist')).resolves.toBe(
      false,
    );
  });
});

describe('DocumentModel.transferTo', () => {
  it('moves a document that carries no slug', async () => {
    const document = await createDocument(documentModel, { slug: null, title: 'No slug' });

    await expect(documentModel.transferTo(document.id, null, userId)).resolves.toEqual({
      documentIds: [document.id],
    });

    const row = await readDocument(document.id);

    expect(row.userId).toBe(userId);
    expect(row.slug).toBeNull();
  });
});
