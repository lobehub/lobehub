// @vitest-environment node
import {
  documentHistories,
  documents,
  quickNoteRunInputs,
  quickNoteRuns,
  quickNotes,
  topics,
  users,
} from '@lobechat/database/schemas';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';

import { DocumentHistoryService } from '../history';

const db = await getTestDB();
const userId = 'quick-note-history-retention';
const service = new DocumentHistoryService(db, userId);
const sourceId = 'quick-note-history-source';
const contextId = 'quick-note-history-context';
const noteId = 'qn_history-retention';
const savedAt = new Date('2026-09-01T00:00:00Z');
const editorData = { root: { children: [] } };

beforeEach(async () => {
  await db.insert(users).values({ id: userId });
  await db.insert(documents).values([
    {
      id: sourceId,
      userId,
      fileType: 'text/plain',
      totalCharCount: 0,
      totalLineCount: 0,
      sourceType: 'api',
      source: 'api',
    },
    {
      id: contextId,
      userId,
      fileType: 'text/plain',
      totalCharCount: 0,
      totalLineCount: 0,
      sourceType: 'api',
      source: 'api',
    },
  ]);
  await db.insert(topics).values({ id: 'quick-note-history-topic', userId });
  await db.insert(quickNotes).values({
    documentId: sourceId,
    id: noteId,
    topicId: 'quick-note-history-topic',
    userId,
  });
});

afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

/** @example Versions referenced by Quick Note evidence survive normal editor maintenance. */
describe('Quick Note history retention', () => {
  // ROOT CAUSE:
  // trimHistoryBySource deleted old revisions solely by age and source limit.
  // CASCADE references removed runs; NO ACTION references made subsequent saves fail.
  // Referenced revisions must be excluded from retention and autosave overwrites.

  /** @example The first run remains inspectable after more than 20 manual source revisions. */
  it('keeps a run and its source revision beyond the history cap', async () => {
    const source = await service.createHistory({
      documentId: sourceId,
      editorData,
      savedAt,
      saveSource: 'manual',
    });
    const [run] = await db
      .insert(quickNoteRuns)
      .values({
        kind: 'analyze',
        quickNoteId: noteId,
        sourceHistoryId: source.id,
      })
      .returning();
    for (let index = 1; index <= 21; index++) {
      await service.createHistory({
        documentId: sourceId,
        editorData,
        saveSource: 'manual',
        savedAt: new Date(savedAt.getTime() + index * 1000),
      });
    }
    /** @example Retention cannot cascade-delete an immutable run. */
    expect(await db.select().from(quickNoteRuns).where(eq(quickNoteRuns.id, run.id))).toHaveLength(
      1,
    );
    /** @example The pinned source remains alongside the 20 unpinned retained versions. */
    expect(
      await db.select().from(documentHistories).where(eq(documentHistories.documentId, sourceId)),
    ).toHaveLength(21);
  });

  /** @example A context document can keep saving after a pinned system revision ages out. */
  it('keeps pinned context inputs without blocking subsequent saves', async () => {
    const source = await service.createHistory({
      documentId: sourceId,
      editorData,
      savedAt,
      saveSource: 'manual',
    });
    const context = await service.createHistory({
      documentId: contextId,
      editorData,
      savedAt,
      saveSource: 'system',
    });
    const [run] = await db
      .insert(quickNoteRuns)
      .values({ kind: 'analyze', quickNoteId: noteId, sourceHistoryId: source.id })
      .returning();
    await db
      .insert(quickNoteRunInputs)
      .values({ documentHistoryId: context.id, role: 'resource', runId: run.id, userId });
    for (let index = 1; index <= 6; index++) {
      await service.createHistory({
        documentId: contextId,
        editorData,
        saveSource: 'system',
        savedAt: new Date(savedAt.getTime() + index * 1000),
      });
    }
    /** @example The pinned revision remains available after six later saves. */
    expect(
      await db.select().from(documentHistories).where(eq(documentHistories.id, context.id)),
    ).toHaveLength(1);
  });

  /** @example Editing within the same autosave window must not rewrite a run's input. */
  it('starts a new autosave revision when the latest version is pinned', async () => {
    const source = await service.createHistory({
      documentId: sourceId,
      editorData,
      savedAt,
      saveSource: 'autosave',
    });
    await db
      .insert(quickNoteRuns)
      .values({ kind: 'analyze', quickNoteId: noteId, sourceHistoryId: source.id });
    const next = await service.createHistory({
      documentId: sourceId,
      editorData: { root: { children: ['new'] } },
      savedAt: new Date(savedAt.getTime() + 1000),
      saveSource: 'autosave',
    });
    /** @example A pinned revision keeps its identity and original content. */
    expect(next.id).not.toBe(source.id);
    const [original] = await db
      .select()
      .from(documentHistories)
      .where(eq(documentHistories.id, source.id));
    /** @example The run still sees the exact version it started with. */
    expect(original.editorData).toEqual(editorData);
  });
});
