// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DocumentModel } from '../document';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'document-quick-note-source-test-user';
const documentModel = new DocumentModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await documentModel.create({
    content: 'Visible document',
    fileType: 'text/markdown',
    filename: 'visible',
    source: 'api',
    sourceType: 'api',
    totalCharCount: 16,
    totalLineCount: 1,
  });
  await documentModel.create({
    content: 'Quick Note source',
    fileType: 'text/markdown',
    filename: 'quick-note',
    source: 'quick-note:qn_1',
    sourceType: 'quick-note',
    totalCharCount: 17,
    totalLineCount: 1,
  });
});

afterEach(async () => {
  await serverDB.delete(documents).where(eq(documents.userId, userId));
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('DocumentModel.query with Quick Note source documents', () => {
  /** @example Quick Note backing Documents stay out of the default document list. */
  it('excludes Quick Note documents by default', async () => {
    const result = await documentModel.query();

    expect(result.items.map((item) => item.sourceType)).toEqual(['api']);
  });

  /** @example Callers can still request Quick Note documents explicitly. */
  it('returns Quick Note documents when sourceTypes requests them', async () => {
    const result = await documentModel.query({ sourceTypes: ['quick-note'] });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].sourceType).toBe('quick-note');
  });
});

/** @example Owning aggregates write their private Documents by id, recycle-bin state included. */
describe('DocumentModel id-targeted writes for owning aggregates', () => {
  const otherUserId = 'document-quick-note-source-other-user';

  beforeEach(async () => {
    await serverDB.delete(users).where(eq(users.id, otherUserId));
    await serverDB.insert(users).values({ id: otherUserId });
  });

  afterEach(async () => {
    await serverDB.delete(users).where(eq(users.id, otherUserId));
  });

  /** @example The body, size counters, and caller save time are written together. */
  it('replaces content with derived counters at an explicit time', async () => {
    const { id } = await documentModel.create({
      content: 'Old',
      fileType: 'text/markdown',
      source: 'quick-note:qn_2',
      sourceType: 'quick-note',
      totalCharCount: 3,
      totalLineCount: 1,
    });
    const savedAt = new Date('2026-08-24T00:00:00.000Z');

    await documentModel.replaceContent(id, { content: 'a\nb', editorData: { v: 2 } }, savedAt);

    const [row] = await serverDB.select().from(documents).where(eq(documents.id, id));
    expect(row).toMatchObject({
      content: 'a\nb',
      editorData: { v: 2 },
      totalCharCount: 3,
      totalLineCount: 2,
      updatedAt: savedAt,
    });
  });

  /** @example A trashed own Document is removed while another user's Document survives. */
  it('deletes trashed rows in scope and leaves foreign rows', async () => {
    const own = await documentModel.create({
      content: 'Trashed',
      fileType: 'text/markdown',
      source: 'quick-note:qn_3',
      sourceType: 'quick-note',
      totalCharCount: 7,
      totalLineCount: 1,
    });
    const foreign = await new DocumentModel(serverDB, otherUserId).create({
      content: 'Foreign',
      fileType: 'text/markdown',
      source: 'quick-note:qn_4',
      sourceType: 'quick-note',
      totalCharCount: 7,
      totalLineCount: 1,
    });
    await serverDB.update(documents).set({ isDeleted: true }).where(eq(documents.id, own.id));

    await documentModel.batchDeleteIncludingTrashed([own.id, foreign.id]);

    const remaining = await serverDB
      .select({ id: documents.id })
      .from(documents)
      .where(inArray(documents.id, [own.id, foreign.id]));
    expect(remaining).toEqual([{ id: foreign.id }]);
  });
});
