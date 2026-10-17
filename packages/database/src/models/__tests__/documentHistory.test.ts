// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documentHistories, documents, files, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DocumentModel } from '../document';
import { DocumentHistoryModel } from '../documentHistory';
import { FileModel } from '../file';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'document-history-model-test-user-id';
const userId2 = 'document-history-model-test-user-id-2';

const documentModel = new DocumentModel(serverDB, userId);
const documentModel2 = new DocumentModel(serverDB, userId2);
const historyModel = new DocumentHistoryModel(serverDB, userId);
const historyModel2 = new DocumentHistoryModel(serverDB, userId2);
const fileModel = new FileModel(serverDB, userId);
const fileModel2 = new FileModel(serverDB, userId2);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
});

afterEach(async () => {
  await serverDB.delete(documentHistories);
  await serverDB.delete(documents);
  await serverDB.delete(files);
  await serverDB.delete(users);
});

const createTestDocument = async (model: DocumentModel, fModel: FileModel, content: string) => {
  const { id: fileId } = await fModel.create({
    fileType: 'text/plain',
    name: 'test.txt',
    size: 100,
    url: 'https://example.com/test.txt',
  });

  const file = await fModel.findById(fileId);
  if (!file) throw new Error('File not found after creation');

  const { id } = await model.create({
    content,
    fileId: file.id,
    fileType: 'text/plain',
    source: file.url,
    sourceType: 'file',
    totalCharCount: content.length,
    totalLineCount: content.split('\n').length,
  });

  return id;
};

describe('DocumentHistoryModel', () => {
  describe('create', () => {
    it('should create a new history row', async () => {
      const documentId = await createTestDocument(documentModel, fileModel, 'Initial content');

      const created = await historyModel.create({
        documentId,
        editorData: { blocks: [] },
        saveSource: 'autosave',
        savedAt: new Date('2026-04-11T00:00:00.000Z'),
      });

      expect(created).toMatchObject({
        documentId,
        saveSource: 'autosave',
        userId,
      });

      const stored = await historyModel.findById(created.id);
      expect(stored).toMatchObject({
        documentId,
        editorData: { blocks: [] },
      });
    });

    it('should reject history rows for documents owned by another user', async () => {
      const otherDocumentId = await createTestDocument(documentModel2, fileModel2, 'Other content');

      await expect(
        historyModel.create({
          documentId: otherDocumentId,
          editorData: { blocks: [] },
          saveSource: 'manual',
          savedAt: new Date('2026-04-11T00:00:00.000Z'),
        }),
      ).rejects.toThrow('Document not found');

      const stored = await serverDB
        .select()
        .from(documentHistories)
        .where(eq(documentHistories.documentId, otherDocumentId));

      expect(stored).toHaveLength(0);
    });
  });

  describe('list', () => {
    it('should return document history rows ordered by savedAt descending', async () => {
      const documentId = await createTestDocument(documentModel, fileModel, 'Initial content');

      await historyModel.create({
        documentId,
        editorData: { tag: 1 },
        saveSource: 'autosave',
        savedAt: new Date('2026-04-11T00:00:01.000Z'),
      });
      await historyModel.create({
        documentId,
        editorData: { tag: 2 },
        saveSource: 'manual',
        savedAt: new Date('2026-04-11T00:00:02.000Z'),
      });
      await historyModel.create({
        documentId,
        editorData: { tag: 3 },
        saveSource: 'restore',
        savedAt: new Date('2026-04-11T00:00:03.000Z'),
      });

      const rows = await historyModel.list({ documentId });

      expect(rows.map((row) => (row.editorData as any).tag)).toEqual([3, 2, 1]);
      expect(rows[0]).toMatchObject({ saveSource: 'restore' });
    });

    it('should support pagination via beforeSavedAt and limit', async () => {
      const documentId = await createTestDocument(documentModel, fileModel, 'Initial content');

      await historyModel.create({
        documentId,
        editorData: { tag: 1 },
        saveSource: 'autosave',
        savedAt: new Date('2026-04-11T00:00:01.000Z'),
      });
      await historyModel.create({
        documentId,
        editorData: { tag: 2 },
        saveSource: 'manual',
        savedAt: new Date('2026-04-11T00:00:02.000Z'),
      });
      await historyModel.create({
        documentId,
        editorData: { tag: 3 },
        saveSource: 'restore',
        savedAt: new Date('2026-04-11T00:00:03.000Z'),
      });

      const anchored = await historyModel.list({
        beforeSavedAt: new Date('2026-04-11T00:00:03.000Z'),
        documentId,
        limit: 1,
      });
      expect(anchored).toHaveLength(1);
      expect((anchored[0]?.editorData as any).tag).toBe(2);
    });
  });

  describe('findLatestByDocumentId', () => {
    it('should return the most recent history row by savedAt', async () => {
      const documentId = await createTestDocument(documentModel, fileModel, 'Initial content');

      await historyModel.create({
        documentId,
        editorData: { tag: 1 },
        saveSource: 'manual',
        savedAt: new Date('2026-04-11T00:00:01.000Z'),
      });
      const latest = await historyModel.create({
        documentId,
        editorData: { tag: 2 },
        saveSource: 'manual',
        savedAt: new Date('2026-04-11T00:00:02.000Z'),
      });

      const row = await historyModel.findLatestByDocumentId(documentId);
      expect(row?.id).toBe(latest.id);
    });
  });

  describe('delete', () => {
    it('should delete a history row for the current user only', async () => {
      const documentId = await createTestDocument(documentModel, fileModel, 'Initial content');
      const otherDocumentId = await createTestDocument(documentModel2, fileModel2, 'Other content');

      const created = await historyModel.create({
        documentId,
        editorData: { tag: 1 },
        saveSource: 'manual',
        savedAt: new Date('2026-04-11T00:00:01.000Z'),
      });
      const otherCreated = await historyModel2.create({
        documentId: otherDocumentId,
        editorData: { tag: 1 },
        saveSource: 'manual',
        savedAt: new Date('2026-04-11T00:00:01.000Z'),
      });

      await historyModel.delete(created.id);

      const deleted = await historyModel.findById(created.id);
      const otherRow = await historyModel2.findById(otherCreated.id);

      expect(deleted).toBeUndefined();
      expect(otherRow).toBeDefined();
    });

    it('should delete all history rows for one document without affecting others', async () => {
      const documentId = await createTestDocument(documentModel, fileModel, 'Initial content');
      const otherDocumentId = await createTestDocument(documentModel2, fileModel2, 'Other content');

      await historyModel.create({
        documentId,
        editorData: { tag: 1 },
        saveSource: 'manual',
        savedAt: new Date('2026-04-11T00:00:01.000Z'),
      });
      await historyModel.create({
        documentId,
        editorData: { tag: 2 },
        saveSource: 'manual',
        savedAt: new Date('2026-04-11T00:00:02.000Z'),
      });
      await historyModel2.create({
        documentId: otherDocumentId,
        editorData: { tag: 1 },
        saveSource: 'manual',
        savedAt: new Date('2026-04-11T00:00:01.000Z'),
      });

      await historyModel.deleteByDocumentId(documentId);

      const rows = await historyModel.list({ documentId });
      const otherRows = await historyModel2.list({ documentId: otherDocumentId });

      expect(rows).toHaveLength(0);
      expect(otherRows).toHaveLength(1);
    });
  });

  describe('schema assumptions', () => {
    it('should keep user scoped history rows isolated', async () => {
      const documentId = await createTestDocument(documentModel, fileModel, 'Initial content');
      const otherDocumentId = await createTestDocument(documentModel2, fileModel2, 'Other content');

      const first = await historyModel.create({
        documentId,
        editorData: { tag: 1 },
        saveSource: 'manual',
        savedAt: new Date('2026-04-11T00:00:01.000Z'),
      });
      await historyModel2.create({
        documentId: otherDocumentId,
        editorData: { tag: 1 },
        saveSource: 'manual',
        savedAt: new Date('2026-04-11T00:00:01.000Z'),
      });

      const rows = await historyModel.list({ documentId });
      const otherRows = await historyModel2.list({ documentId: otherDocumentId });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(first.id);
      expect(otherRows).toHaveLength(1);
    });
  });
});

describe('DocumentHistoryModel.deleteAll', () => {
  it('should delete only the current user rows', async () => {
    const documentId = await createTestDocument(documentModel, fileModel, 'Initial content');
    const otherDocumentId = await createTestDocument(documentModel2, fileModel2, 'Other content');

    await historyModel.create({
      documentId,
      editorData: { tag: 1 },
      saveSource: 'manual',
      savedAt: new Date('2026-04-11T00:00:01.000Z'),
    });
    await historyModel2.create({
      documentId: otherDocumentId,
      editorData: { tag: 1 },
      saveSource: 'manual',
      savedAt: new Date('2026-04-11T00:00:01.000Z'),
    });

    await historyModel.deleteAll();

    expect(await historyModel.list({ documentId })).toHaveLength(0);
    expect(await historyModel2.list({ documentId: otherDocumentId })).toHaveLength(1);
  });
});

describe('DocumentHistoryModel.query', () => {
  it('should mirror list', async () => {
    const documentId = await createTestDocument(documentModel, fileModel, 'Initial content');

    await historyModel.create({
      documentId,
      editorData: { tag: 1 },
      saveSource: 'manual',
      savedAt: new Date('2026-04-11T00:00:01.000Z'),
    });

    const rows = await historyModel.query({ documentId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ documentId });
  });
});

describe('DocumentHistoryModel.listByDocumentId', () => {
  it('should page with the default and an explicit limit', async () => {
    const documentId = await createTestDocument(documentModel, fileModel, 'Initial content');

    for (const i of [1, 2, 3]) {
      await historyModel.create({
        documentId,
        editorData: { tag: i },
        saveSource: 'manual',
        savedAt: new Date(`2026-04-11T00:00:0${i}.000Z`),
      });
    }

    expect(await historyModel.listByDocumentId(documentId)).toHaveLength(3);
    expect(await historyModel.listByDocumentId(documentId, 2)).toHaveLength(2);
  });
});

describe('DocumentHistoryModel.list cursor', () => {
  it('should break a savedAt tie with the beforeId cursor', async () => {
    const documentId = await createTestDocument(documentModel, fileModel, 'Initial content');
    const savedAt = new Date('2026-04-11T00:00:05.000Z');

    const first = await historyModel.create({
      documentId,
      editorData: { tag: 'tie-a' },
      saveSource: 'manual',
      savedAt,
    });
    const second = await historyModel.create({
      documentId,
      editorData: { tag: 'tie-b' },
      saveSource: 'manual',
      savedAt,
    });

    // The tie-break is a *database* comparison (`saved_at = ? AND id < ?`)
    // under the column collation, which is not JavaScript's code-unit order —
    // with `en_US.utf8`, 'a' < 'B' but 'Z' > 'a'. Ordering the ids with
    // `Array.sort()` therefore disagrees with the query roughly half the time
    // and the cursor page comes back empty, so anchor on the row the database
    // itself reports as newest and expect the other one back.
    const [newest, older] = await historyModel.list({ documentId });
    expect(new Set([newest.id, older.id])).toEqual(new Set([first.id, second.id]));

    const rows = await historyModel.list({
      beforeId: newest.id,
      beforeSavedAt: new Date(newest.savedAt),
      documentId,
    });

    expect(rows.map((row) => row.id)).toEqual([older.id]);
  });

  it('should ignore beforeId when there is no savedAt anchor', async () => {
    const documentId = await createTestDocument(documentModel, fileModel, 'Initial content');

    for (const i of [1, 2, 3]) {
      await historyModel.create({
        documentId,
        editorData: { tag: i },
        saveSource: 'manual',
        savedAt: new Date(`2026-04-11T00:00:0${i}.000Z`),
      });
    }

    const rows = await historyModel.list({
      beforeId: '00000000-0000-0000-0000-000000000000',
      documentId,
    });

    expect(rows).toHaveLength(3);
  });
});
