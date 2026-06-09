// @vitest-environment node
import { documentHistories, documents, files, users } from '@lobechat/database/schemas';
import { and, desc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DOCUMENT_HISTORY_SOURCE_LIMITS } from '@/const/documentHistory';
import { getTestDB } from '@/database/core/getTestDB';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import type { LobeChatDatabase } from '@/database/type';

import { DocumentHistoryService } from '../history';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'document-history-service-test-user-id';
const userId2 = 'document-history-service-test-user-id-2';

const documentModel = new DocumentModel(serverDB, userId);
const fileModel = new FileModel(serverDB, userId);
const historyService = new DocumentHistoryService(serverDB, userId);
const historyService2 = new DocumentHistoryService(serverDB, userId2);

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

const createTestDocument = async (content: string, editorData?: Record<string, any>) => {
  const { id: fileId } = await fileModel.create({
    fileType: 'text/plain',
    name: 'test.txt',
    size: 100,
    url: 'https://example.com/test.txt',
  });

  const doc = await documentModel.create({
    content,
    editorData,
    fileId,
    fileType: 'text/plain',
    filename: 'test.txt',
    source: 'api',
    sourceType: 'api',
    title: 'Test Document',
    totalCharCount: content.length,
    totalLineCount: content.split('\n').length,
  });

  return doc;
};

const createValidEditorData = (text: string) => ({
  root: {
    children: [
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text,
            type: 'text',
            version: 1,
          },
        ],
        direction: 'ltr',
        format: '',
        indent: 0,
        type: 'paragraph',
        version: 1,
      },
    ],
    direction: 'ltr',
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
});

describe('DocumentHistoryService', () => {
  describe('createHistory & listDocumentHistory', () => {
    it('should create history entries and list them with head included', async () => {
      const doc = await createTestDocument('Hello');

      await historyService.createHistory({
        documentId: doc.id,
        editorData: { v: 1 },
        saveSource: 'autosave',
        savedAt: new Date('2026-04-01T10:00:00Z'),
      });

      await historyService.createHistory({
        documentId: doc.id,
        editorData: { v: 2 },
        saveSource: 'manual',
        savedAt: new Date('2026-04-02T10:00:00Z'),
      });

      const result = await historyService.listDocumentHistory({
        documentId: doc.id,
        includeCurrent: true,
        limit: 10,
      });

      expect(result.items).toHaveLength(3);
      expect(result.items[0].id).toBe('head');
      expect(result.items[0].isCurrent).toBe(true);
      expect(result.items[1].saveSource).toBe('manual');
      expect(result.items[2].saveSource).toBe('autosave');
    });

    it('should respect includeCurrent=false', async () => {
      const doc = await createTestDocument('Hello');

      await historyService.createHistory({
        documentId: doc.id,
        editorData: { v: 1 },
        saveSource: 'autosave',
        savedAt: new Date('2026-04-01T10:00:00Z'),
      });

      const result = await historyService.listDocumentHistory({
        documentId: doc.id,
        includeCurrent: false,
        limit: 10,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].isCurrent).toBe(false);
    });

    it('should paginate correctly using beforeSavedAt and beforeId cursor', async () => {
      const doc = await createTestDocument('Hello');
      const baseDate = new Date('2026-04-01T10:00:00Z');

      // Create multiple history rows with the same savedAt to test id tie-breaker
      for (let i = 0; i < 5; i++) {
        await historyService.createHistory({
          documentId: doc.id,
          editorData: { v: i },
          saveSource: 'manual',
          savedAt: new Date(baseDate.getTime()),
        });
      }

      // Fetch all rows and sort by (savedAt DESC, id DESC) to know expected order
      const allRows = await serverDB
        .select({ id: documentHistories.id, savedAt: documentHistories.savedAt })
        .from(documentHistories)
        .where(eq(documentHistories.documentId, doc.id))
        .orderBy(desc(documentHistories.savedAt), desc(documentHistories.id));

      const sortedIds = allRows.map((r) => r.id);
      expect(sortedIds).toHaveLength(5);

      const firstPage = await historyService.listDocumentHistory({
        documentId: doc.id,
        includeCurrent: false,
        limit: 2,
      });

      expect(firstPage.items.map((i) => i.id)).toEqual(sortedIds.slice(0, 2));
      expect(firstPage.nextBeforeSavedAt).toBeDefined();
      expect(firstPage.nextBeforeId).toBeDefined();

      const secondPage = await historyService.listDocumentHistory({
        beforeId: firstPage.nextBeforeId,
        beforeSavedAt: firstPage.nextBeforeSavedAt,
        documentId: doc.id,
        includeCurrent: false,
        limit: 2,
      });

      expect(secondPage.items.map((i) => i.id)).toEqual(sortedIds.slice(2, 4));
      expect(secondPage.nextBeforeSavedAt).toBeDefined();
      expect(secondPage.nextBeforeId).toBeDefined();

      const thirdPage = await historyService.listDocumentHistory({
        beforeId: secondPage.nextBeforeId,
        beforeSavedAt: secondPage.nextBeforeSavedAt,
        documentId: doc.id,
        includeCurrent: false,
        limit: 2,
      });

      expect(thirdPage.items.map((i) => i.id)).toEqual(sortedIds.slice(4, 5));
      expect(thirdPage.nextBeforeSavedAt).toBeUndefined();
      expect(thirdPage.nextBeforeId).toBeUndefined();
    });

    it('should not duplicate head when paginating with includeCurrent=true and same timestamp', async () => {
      const doc = await createTestDocument('Hello');
      const sharedDate = new Date('2026-04-01T10:00:00Z');

      // Create enough history rows so pagination has a second page
      for (let i = 0; i < 3; i++) {
        await historyService.createHistory({
          documentId: doc.id,
          editorData: { v: i },
          saveSource: 'manual',
          savedAt: sharedDate,
        });
      }

      // Force document updatedAt to match the history savedAt
      await documentModel.update(doc.id, { updatedAt: sharedDate });

      const firstPage = await historyService.listDocumentHistory({
        documentId: doc.id,
        includeCurrent: true,
        limit: 2,
      });

      expect(firstPage.items[0].id).toBe('head');
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.nextBeforeSavedAt).toBeDefined();
      expect(firstPage.nextBeforeId).toBeDefined();

      // Paginating past the first page should never include head again
      const secondPage = await historyService.listDocumentHistory({
        beforeId: firstPage.nextBeforeId,
        beforeSavedAt: firstPage.nextBeforeSavedAt,
        documentId: doc.id,
        includeCurrent: true,
        limit: 2,
      });

      for (const item of secondPage.items) {
        expect(item.id).not.toBe('head');
      }
    });

    it('should emit a cursor when limit=1 and includeCurrent=true', async () => {
      const doc = await createTestDocument('Hello');

      await historyService.createHistory({
        documentId: doc.id,
        editorData: { v: 1 },
        saveSource: 'manual',
        savedAt: new Date('2026-04-01T10:00:00Z'),
      });

      await historyService.createHistory({
        documentId: doc.id,
        editorData: { v: 2 },
        saveSource: 'manual',
        savedAt: new Date('2026-04-02T10:00:00Z'),
      });

      // limit=1 with includeCurrent=true is promoted to an effective limit of 2
      // so that head plus at least one history item can be returned without
      // creating a cursor that would skip a dropped row.
      const firstPage = await historyService.listDocumentHistory({
        documentId: doc.id,
        includeCurrent: true,
        limit: 1,
      });

      expect(firstPage.items[0].id).toBe('head');
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.nextBeforeSavedAt).toBeDefined();
      expect(firstPage.nextBeforeId).toBeDefined();

      const secondPage = await historyService.listDocumentHistory({
        beforeId: firstPage.nextBeforeId,
        beforeSavedAt: firstPage.nextBeforeSavedAt,
        documentId: doc.id,
        includeCurrent: true,
        limit: 1,
      });

      expect(secondPage.items[0].id).not.toBe('head');
      expect(secondPage.items).toHaveLength(1);
    });

    it('should filter out entries older than historySince', async () => {
      const doc = await createTestDocument('Hello');

      await historyService.createHistory({
        documentId: doc.id,
        editorData: { v: 1 },
        saveSource: 'autosave',
        savedAt: new Date('2026-04-01T10:00:00Z'),
      });

      await historyService.createHistory({
        documentId: doc.id,
        editorData: { v: 2 },
        saveSource: 'manual',
        savedAt: new Date('2026-04-10T10:00:00Z'),
      });

      const result = await historyService.listDocumentHistory(
        { documentId: doc.id, includeCurrent: true, limit: 10 },
        { historySince: new Date('2026-04-05T00:00:00Z') },
      );

      const historyItems = result.items.filter((i) => i.id !== 'head');
      expect(historyItems).toHaveLength(1);
      expect(historyItems[0].saveSource).toBe('manual');
    });

    it('should trim autosave history to 20 and manual history to 20 independently', async () => {
      const doc = await createTestDocument('Hello');

      for (let i = 0; i < 25; i++) {
        await historyService.createHistory({
          documentId: doc.id,
          editorData: { v: i },
          saveSource: 'autosave',
          savedAt: new Date(`2026-04-01T${String(i).padStart(2, '0')}:00:00Z`),
        });
      }

      for (let i = 0; i < 25; i++) {
        await historyService.createHistory({
          documentId: doc.id,
          editorData: { v: i + 100 },
          saveSource: 'manual',
          savedAt: new Date(`2026-04-02T${String(i).padStart(2, '0')}:00:00Z`),
        });
      }

      const autosaveRows = await serverDB
        .select({ id: documentHistories.id })
        .from(documentHistories)
        .where(
          and(
            eq(documentHistories.documentId, doc.id),
            eq(documentHistories.saveSource, 'autosave'),
          ),
        )
        .orderBy(desc(documentHistories.savedAt), desc(documentHistories.id));

      const manualRows = await serverDB
        .select({ id: documentHistories.id })
        .from(documentHistories)
        .where(
          and(eq(documentHistories.documentId, doc.id), eq(documentHistories.saveSource, 'manual')),
        )
        .orderBy(desc(documentHistories.savedAt), desc(documentHistories.id));

      expect(autosaveRows).toHaveLength(DOCUMENT_HISTORY_SOURCE_LIMITS.autosave);
      expect(manualRows).toHaveLength(DOCUMENT_HISTORY_SOURCE_LIMITS.manual);

      // Verify the newest items are retained (latest autosave should be v=24)
      const latestAutosave = await serverDB
        .select({ editorData: documentHistories.editorData })
        .from(documentHistories)
        .where(
          and(
            eq(documentHistories.documentId, doc.id),
            eq(documentHistories.saveSource, 'autosave'),
          ),
        )
        .orderBy(desc(documentHistories.savedAt), desc(documentHistories.id))
        .limit(1);

      expect(latestAutosave[0].editorData).toEqual({ v: 24 });
    });

    it('should trim restore history to 5 and system history to 5 independently', async () => {
      const doc = await createTestDocument('Hello');

      for (let i = 0; i < 10; i++) {
        await historyService.createHistory({
          documentId: doc.id,
          editorData: { restore: i },
          saveSource: 'restore',
          savedAt: new Date(`2026-04-01T${String(i).padStart(2, '0')}:00:00Z`),
        });
      }

      for (let i = 0; i < 10; i++) {
        await historyService.createHistory({
          documentId: doc.id,
          editorData: { system: i },
          saveSource: 'system',
          savedAt: new Date(`2026-04-02T${String(i).padStart(2, '0')}:00:00Z`),
        });
      }

      const restoreRows = await serverDB
        .select({ id: documentHistories.id })
        .from(documentHistories)
        .where(
          and(
            eq(documentHistories.documentId, doc.id),
            eq(documentHistories.saveSource, 'restore'),
          ),
        );

      const systemRows = await serverDB
        .select({ id: documentHistories.id })
        .from(documentHistories)
        .where(
          and(eq(documentHistories.documentId, doc.id), eq(documentHistories.saveSource, 'system')),
        );

      expect(restoreRows).toHaveLength(DOCUMENT_HISTORY_SOURCE_LIMITS.restore);
      expect(systemRows).toHaveLength(DOCUMENT_HISTORY_SOURCE_LIMITS.system);
    });

    it('should handle large overflow trimming without error', async () => {
      const doc = await createTestDocument('Hello');

      // Seed 150 autosave rows to exercise the batch deletion path
      for (let i = 0; i < 150; i++) {
        await historyService.createHistory({
          documentId: doc.id,
          editorData: { v: i },
          saveSource: 'autosave',
          savedAt: new Date(2026, 3, 1, 0, i, 0),
        });
      }

      const remainingRows = await serverDB
        .select({ id: documentHistories.id })
        .from(documentHistories)
        .where(
          and(
            eq(documentHistories.documentId, doc.id),
            eq(documentHistories.saveSource, 'autosave'),
          ),
        );

      expect(remainingRows).toHaveLength(DOCUMENT_HISTORY_SOURCE_LIMITS.autosave);
    });

    it('should trim llm_call history to 5 independently', async () => {
      const doc = await createTestDocument('Hello');

      for (let i = 0; i < 10; i++) {
        await historyService.createHistory({
          documentId: doc.id,
          editorData: { llm: i },
          saveSource: 'llm_call',
          savedAt: new Date(`2026-04-01T${String(i).padStart(2, '0')}:00:00Z`),
        });
      }

      const llmCallRows = await serverDB
        .select({ id: documentHistories.id })
        .from(documentHistories)
        .where(
          and(
            eq(documentHistories.documentId, doc.id),
            eq(documentHistories.saveSource, 'llm_call'),
          ),
        );

      expect(llmCallRows).toHaveLength(DOCUMENT_HISTORY_SOURCE_LIMITS.llm_call);
    });
  });

  describe('getDocumentHistoryItem', () => {
    it('should resolve head as current document state', async () => {
      const editorData = createValidEditorData('Head content');
      const doc = await createTestDocument('Head content', editorData);

      const result = await historyService.getDocumentHistoryItem({
        documentId: doc.id,
        historyId: 'head',
      });

      expect(result.id).toBe('head');
      expect(result.isCurrent).toBe(true);
      expect(result.editorData).toEqual(editorData);
      expect(result.saveSource).toBe('system');
    });

    it('should return null for head editorData when current document editorData is invalid', async () => {
      const doc = await createTestDocument('Head content', {});

      const result = await historyService.getDocumentHistoryItem({
        documentId: doc.id,
        historyId: 'head',
      });

      expect(result.id).toBe('head');
      expect(result.isCurrent).toBe(true);
      expect(result.editorData).toBeNull();
      expect(result.saveSource).toBe('system');
    });

    it('should return a persisted history item', async () => {
      const doc = await createTestDocument('Hello');
      const savedAt = new Date('2026-04-01T10:00:00Z');

      await historyService.createHistory({
        documentId: doc.id,
        editorData: { version: 42 },
        saveSource: 'manual',
        savedAt,
      });

      const [row] = await serverDB
        .select({ id: documentHistories.id })
        .from(documentHistories)
        .where(eq(documentHistories.documentId, doc.id));

      const result = await historyService.getDocumentHistoryItem({
        documentId: doc.id,
        historyId: row!.id,
      });

      expect(result.id).toBe(row!.id);
      expect(result.isCurrent).toBe(false);
      expect(result.editorData).toEqual({ version: 42 });
      expect(result.saveSource).toBe('manual');
    });

    it('should throw when history item is older than historySince', async () => {
      const doc = await createTestDocument('Hello');

      await historyService.createHistory({
        documentId: doc.id,
        editorData: { v: 1 },
        saveSource: 'autosave',
        savedAt: new Date('2026-04-01T10:00:00Z'),
      });

      const [row] = await serverDB
        .select({ id: documentHistories.id })
        .from(documentHistories)
        .where(eq(documentHistories.documentId, doc.id));

      await expect(
        historyService.getDocumentHistoryItem(
          { documentId: doc.id, historyId: row!.id },
          { historySince: new Date('2026-04-05T00:00:00Z') },
        ),
      ).rejects.toThrow();
    });

    it('should throw for a historyId belonging to another user', async () => {
      const doc = await createTestDocument('Hello');

      await historyService.createHistory({
        documentId: doc.id,
        editorData: { v: 1 },
        saveSource: 'autosave',
        savedAt: new Date('2026-04-01T10:00:00Z'),
      });

      const [row] = await serverDB
        .select({ id: documentHistories.id })
        .from(documentHistories)
        .where(eq(documentHistories.documentId, doc.id));

      await expect(
        historyService2.getDocumentHistoryItem({
          documentId: doc.id,
          historyId: row!.id,
        }),
      ).rejects.toThrow();
    });
  });

  describe('compareDocumentHistoryItems', () => {
    it('should compare a history item against head', async () => {
      const currentEditorData = createValidEditorData('Current');
      const doc = await createTestDocument('Current', currentEditorData);

      await historyService.createHistory({
        documentId: doc.id,
        editorData: { old: true },
        saveSource: 'manual',
        savedAt: new Date('2026-04-01T10:00:00Z'),
      });

      const [row] = await serverDB
        .select({ id: documentHistories.id })
        .from(documentHistories)
        .where(eq(documentHistories.documentId, doc.id));

      const result = await historyService.compareDocumentHistoryItems({
        documentId: doc.id,
        fromHistoryId: row!.id,
        toHistoryId: 'head',
      });

      expect(result.from.editorData).toEqual({ old: true });
      expect(result.to.editorData).toEqual(currentEditorData);
      expect(result.to.isCurrent).toBe(true);
    });
  });
});
