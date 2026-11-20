// @vitest-environment node
import { documentHistories, documents, files, users } from '@lobechat/database/schemas';
import { desc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import type { LobeChatDatabase } from '@/database/type';

import { DocumentHistoryService } from '../history';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'history-attribution-owner';
const memberId = 'history-attribution-member';

const historyService = new DocumentHistoryService(serverDB, ownerId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: ownerId }, { id: memberId }]);
});

afterEach(async () => {
  await serverDB.delete(documentHistories);
  await serverDB.delete(documents);
  await serverDB.delete(files);
  await serverDB.delete(users);
});

const createTestDocument = async () => {
  const { id: fileId } = await new FileModel(serverDB, ownerId).create({
    fileType: 'text/plain',
    name: 'test.txt',
    size: 100,
    url: 'https://example.com/test.txt',
  });
  return new DocumentModel(serverDB, ownerId).create({
    content: 'Hello',
    fileId,
    fileType: 'text/plain',
    filename: 'test.txt',
    source: 'api',
    sourceType: 'api',
    title: 'Test Document',
    totalCharCount: 5,
    totalLineCount: 1,
  });
};

const base = new Date('2026-04-01T10:00:00Z');
const minutes = (n: number) => new Date(base.getTime() + n * 60 * 1000);

const listRows = (documentId: string) =>
  serverDB
    .select()
    .from(documentHistories)
    .where(eq(documentHistories.documentId, documentId))
    .orderBy(desc(documentHistories.savedAt), desc(documentHistories.id));

describe('DocumentHistoryService attribution', () => {
  it('records the first editor as the version author', async () => {
    const doc = await createTestDocument();

    await historyService.createHistory({
      documentId: doc.id,
      editorData: { v: 1 },
      editorIds: [memberId],
      saveSource: 'autosave',
      savedAt: base,
    });

    const [row] = await listRows(doc.id);
    expect(row.userId).toBe(memberId);
    expect(row.editorIds).toEqual([memberId]);
  });

  it('keeps the service user as author when no editor is given', async () => {
    const doc = await createTestDocument();

    await historyService.createHistory({
      documentId: doc.id,
      editorData: { v: 1 },
      saveSource: 'manual',
      savedAt: base,
    });

    const [row] = await listRows(doc.id);
    expect(row.userId).toBe(ownerId);
    expect(row.editorIds).toBeNull();
  });

  it('joins everyone who edited within one autosave window into a single version', async () => {
    const doc = await createTestDocument();

    await historyService.createHistory({
      documentId: doc.id,
      editorData: { v: 1 },
      editorIds: [ownerId],
      saveSource: 'autosave',
      savedAt: base,
    });
    await historyService.createHistory({
      documentId: doc.id,
      editorData: { v: 2 },
      editorIds: [memberId, ownerId],
      saveSource: 'autosave',
      savedAt: minutes(3),
    });

    const rows = await listRows(doc.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].editorIds).toEqual([ownerId, memberId]);
    expect(rows[0].editorData).toEqual({ v: 2 });
  });

  it('attributes a legacy autosave version to its author when others join it', async () => {
    const doc = await createTestDocument();

    await historyService.createHistory({
      documentId: doc.id,
      editorData: { v: 1 },
      saveSource: 'autosave',
      savedAt: base,
    });
    await historyService.createHistory({
      documentId: doc.id,
      editorData: { v: 2 },
      editorIds: [memberId],
      saveSource: 'autosave',
      savedAt: minutes(3),
    });

    const [row] = await listRows(doc.id);
    expect(row.editorIds).toEqual([ownerId, memberId]);
  });

  it('lists editors and the agent of each version', async () => {
    const doc = await createTestDocument();

    await historyService.createHistory({
      agentId: 'agt_1',
      documentId: doc.id,
      editorData: { v: 1 },
      editorIds: [ownerId],
      operationId: 'op_1',
      saveSource: 'llm_call',
      savedAt: base,
    });

    const { items } = await historyService.listDocumentHistory({
      documentId: doc.id,
      includeCurrent: false,
    });
    expect(items[0]).toMatchObject({ agentId: 'agt_1', editorIds: [ownerId] });
  });
});

describe('DocumentHistoryService agent runs', () => {
  it('keeps one AI version per agent run: the state before its first edit', async () => {
    const doc = await createTestDocument();

    for (const [i, at] of [base, minutes(1), minutes(2)].entries()) {
      await historyService.createHistory({
        agentId: 'agt_1',
        documentId: doc.id,
        editorData: { v: i + 1 },
        editorIds: [ownerId],
        operationId: 'op_1',
        saveSource: 'llm_call',
        savedAt: at,
      });
    }

    const rows = await listRows(doc.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ editorData: { v: 1 }, operationId: 'op_1' });
  });

  it('starts a new AI version for another run', async () => {
    const doc = await createTestDocument();

    for (const [i, operationId] of ['op_1', 'op_2'].entries()) {
      await historyService.createHistory({
        documentId: doc.id,
        editorData: { v: i + 1 },
        operationId,
        saveSource: 'llm_call',
        savedAt: minutes(i),
      });
    }

    expect(await listRows(doc.id)).toHaveLength(2);
  });

  it('joins the editors of later edits in the run', async () => {
    const doc = await createTestDocument();

    for (const [i, editor] of [ownerId, memberId].entries()) {
      await historyService.createHistory({
        documentId: doc.id,
        editorData: { v: i + 1 },
        editorIds: [editor],
        operationId: 'op_1',
        saveSource: 'llm_call',
        savedAt: minutes(i),
      });
    }

    const [row] = await listRows(doc.id);
    expect(row.editorIds).toEqual([ownerId, memberId]);
  });

  it('keeps the AI version when the user keeps typing in the same window', async () => {
    const doc = await createTestDocument();

    await historyService.createHistory({
      documentId: doc.id,
      editorData: { v: 'before agent' },
      operationId: 'op_1',
      saveSource: 'llm_call',
      savedAt: base,
    });
    for (const at of [minutes(1), minutes(2)]) {
      await historyService.createHistory({
        documentId: doc.id,
        editorData: { v: `typing ${at.getTime()}` },
        saveSource: 'autosave',
        savedAt: at,
      });
    }

    const rows = await listRows(doc.id);
    expect(rows.map((row) => row.saveSource)).toEqual(['autosave', 'llm_call']);
    expect(rows[1].editorData).toEqual({ v: 'before agent' });
  });
});
