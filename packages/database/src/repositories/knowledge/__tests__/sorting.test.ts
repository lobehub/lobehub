// @vitest-environment node
import { SortType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { documents, files, knowledgeBaseFiles, knowledgeBases, users } from '../../../schemas';
import { KnowledgeRepo } from '../index';

const db = await getTestDB();
const userId = 'sorting-user';
const knowledgeBaseId = 'sorting-kb';
const timestamp = new Date('2024-01-01T00:00:00Z');
const repo = new KnowledgeRepo(db, userId);

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: 'sorting-other' }]);
  await db.insert(knowledgeBases).values({ id: knowledgeBaseId, name: 'Sorting', userId });
});

afterAll(async () => {
  await db.delete(users);
});

const addDocument = async (
  id: string,
  title: string,
  options: {
    fileId?: string;
    fileType?: string;
    metadata?: Record<string, unknown>;
    userId?: string;
  } = {},
) => {
  await db.insert(documents).values({
    createdAt: timestamp,
    fileType: 'custom/document',
    id,
    knowledgeBaseId,
    source: 'internal://sorting',
    sourceType: 'topic',
    title,
    totalCharCount: 0,
    totalLineCount: 0,
    updatedAt: timestamp,
    userId,
    ...options,
  });
};

const addFile = async (id: string, name: string, metadata?: Record<string, unknown>) => {
  await db.insert(files).values({
    createdAt: timestamp,
    fileType: 'text/plain',
    id,
    metadata,
    name,
    size: 10,
    updatedAt: timestamp,
    url: '/sorting',
    userId,
  });
  await db.insert(knowledgeBaseFiles).values({ fileId: id, knowledgeBaseId, userId });
};

const listIds = async (sorter: string, sortType = SortType.Asc, includeContent = true) =>
  (await repo.query({ includeContent, knowledgeBaseId, sorter, sortType })).map((item) => item.id);

describe('knowledge resource sorting', () => {
  it.each([true, false])(
    'sorts numeric names naturally with folders first (content=%s)',
    async (includeContent) => {
      await addDocument('docs_folder', '99_folder', { fileType: 'custom/folder' });
      await addDocument('docs_10', '10_中文');
      await addDocument('docs_01', '01_中文');
      await addFile('file_02', '02_中文');
      expect(await listIds('name', SortType.Asc, includeContent)).toEqual([
        'docs_folder',
        'docs_01',
        'file_02',
        'docs_10',
      ]);
      expect(await listIds('name', SortType.Desc, includeContent)).toEqual([
        'docs_folder',
        'docs_10',
        'file_02',
        'docs_01',
      ]);
    },
  );

  it('sorts the first embedded number and breaks equal names by id', async () => {
    await addDocument('docs_10', '第10章');
    await addDocument('docs_02_b', '第2章');
    await addDocument('docs_02_a', '第2章');
    expect(await listIds('name')).toEqual(['docs_02_a', 'docs_02_b', 'docs_10']);
  });

  it('uses numeric metadata weights and natural fallback, always keeping folders first', async () => {
    await addDocument('docs_folder', 'Folder', { fileType: 'custom/folder' });
    await addDocument('docs_weighted', 'Z page', { metadata: { sortOrder: 1000 } });
    await addFile('file_weighted', 'A file', { sortOrder: 2000 });
    await addDocument('docs_missing', '10_page');
    await addFile('file_invalid', '2_file', { sortOrder: 'invalid' });
    expect(await listIds('custom')).toEqual([
      'docs_folder',
      'docs_weighted',
      'file_weighted',
      'file_invalid',
      'docs_missing',
    ]);
    expect(await listIds('custom', SortType.Desc)).toEqual([
      'docs_folder',
      'file_weighted',
      'docs_weighted',
      'docs_missing',
      'file_invalid',
    ]);
    expect(
      (await repo.query({ knowledgeBaseId, sorter: 'custom' })).map((item) => item.id),
    ).toEqual(await listIds('custom'));
    expect(
      (await repo.query({ sorter: 'custom', showFilesInKnowledgeBase: true })).map(
        (item) => item.id,
      ),
    ).toEqual(await listIds('custom'));
    for (const sorter of ['createdAt', 'size', 'updatedAt']) {
      expect((await listIds(sorter, SortType.Desc))[0]).toBe('docs_folder');
    }
  });

  it.each(['custom', 'name', 'createdAt', 'size', 'updatedAt'])(
    'uses directional natural fallback and ascending ids across pages for %s',
    async (sorter) => {
      await addDocument('docs_2', 'same');
      await addDocument('docs_10', 'same');
      await addDocument('docs_number', '10_page');
      await addFile('file_number', '2_file');
      for (const sortType of [SortType.Asc, SortType.Desc]) {
        const expected =
          sortType === SortType.Asc
            ? ['file_number', 'docs_number', 'docs_10', 'docs_2']
            : ['docs_10', 'docs_2', 'docs_number', 'file_number'];
        // Size differs between files and pages; give both arms the same size.
        if (sorter === 'size') await db.update(files).set({ size: 0 });
        const ids: string[] = [];
        for (let offset = 0; offset < 4; offset += 2) {
          const page = await repo.query({ knowledgeBaseId, sorter, sortType, limit: 2, offset });
          ids.push(...page.map((item) => item.id));
        }
        expect(ids).toEqual(expected);
      }
    },
  );

  it('rejects an unowned library without mutating any rows', async () => {
    await db
      .insert(knowledgeBases)
      .values({ id: 'foreign-kb', name: 'Foreign', userId: 'sorting-other' });
    await addDocument('docs_owned', 'Owned', { metadata: { emoji: '📄' } });
    await addFile('file_owned', 'Owned', { original: true });
    await db.update(documents).set({ knowledgeBaseId: 'foreign-kb' });
    await db.update(knowledgeBaseFiles).set({ knowledgeBaseId: 'foreign-kb' });
    const beforeDocs = await db.select().from(documents);
    const beforeFiles = await db.select().from(files);
    const beforeLinks = await db.select().from(knowledgeBaseFiles);

    expect(await repo.reorderItems('foreign-kb', ['docs_owned', 'file_owned'])).toEqual({
      success: false,
    });
    expect(await db.select().from(documents)).toEqual(beforeDocs);
    expect(await db.select().from(files)).toEqual(beforeFiles);
    expect(await db.select().from(knowledgeBaseFiles)).toEqual(beforeLinks);
  });

  it('ignores rows outside the target library and foreign-owned file pairs', async () => {
    await addDocument('docs_unlinked', 'Unlinked');
    await db
      .update(documents)
      .set({ knowledgeBaseId: null })
      .where(eq(documents.id, 'docs_unlinked'));
    await addFile('file_unlinked', 'Unlinked');
    await db.delete(knowledgeBaseFiles).where(eq(knowledgeBaseFiles.fileId, 'file_unlinked'));
    await addFile('file_foreign', 'Foreign', { emoji: '🔒' });
    await db.update(files).set({ userId: 'sorting-other' }).where(eq(files.id, 'file_foreign'));
    await addDocument('docs_foreign_pair', 'Foreign page', {
      fileId: 'file_foreign',
      userId: 'sorting-other',
    });

    await repo.reorderItems(knowledgeBaseId, ['docs_unlinked', 'file_unlinked', 'file_foreign']);

    expect((await db.select().from(documents)).every((row) => !row.metadata?.sortOrder)).toBe(true);
    const fileRows = await db.select().from(files);
    expect(fileRows.find((row) => row.id === 'file_unlinked')?.metadata).toBeNull();
    expect(fileRows.find((row) => row.id === 'file_foreign')?.metadata).toEqual({ emoji: '🔒' });
  });

  it('reorders folders, pages and paired files without losing metadata or changing timestamps', async () => {
    await addDocument('docs_folder', 'Folder', {
      fileType: 'custom/folder',
      metadata: { emoji: '📁' },
    });
    await addDocument('docs_page', 'Page', { metadata: { emoji: '📄' } });
    await addFile('file_backing', 'Backing', { original: true });
    await addDocument('docs_backing', 'Backing page', {
      fileId: 'file_backing',
      metadata: { emoji: '📑' },
    });
    await addFile('file_direct', 'Direct', { original: true });
    await addDocument('docs_direct', 'Direct page', {
      fileId: 'file_direct',
      metadata: { emoji: '📃' },
    });
    await addFile('file_raw', 'Raw');
    await addDocument('docs_foreign', 'Foreign', {
      userId: 'sorting-other',
      metadata: { emoji: '🔒' },
    });

    expect(
      await repo.reorderItems(knowledgeBaseId, [
        'docs_folder',
        'docs_page',
        'docs_page',
        'docs_backing',
        'file_direct',
        'file_raw',
        'docs_foreign',
      ]),
    ).toEqual({ success: true });
    const docRows = await db.select().from(documents);
    const fileRows = await db.select().from(files);
    for (const [id, sortOrder, emoji] of [
      ['docs_folder', 1000, '📁'],
      ['docs_page', 2000, '📄'],
      ['docs_backing', 3000, '📑'],
      ['docs_direct', 4000, '📃'],
    ] as const) {
      const row = docRows.find((item) => item.id === id)!;
      expect(row.metadata).toEqual({ emoji, sortOrder });
      expect(row.updatedAt).toEqual(timestamp);
    }
    for (const [id, sortOrder] of [
      ['file_backing', 3000],
      ['file_direct', 4000],
      ['file_raw', 5000],
    ] as const) {
      const row = fileRows.find((item) => item.id === id)!;
      expect(row.metadata).toEqual(
        id === 'file_raw' ? { sortOrder } : { original: true, sortOrder },
      );
      expect(row.updatedAt).toEqual(timestamp);
    }
    expect(docRows.find((item) => item.id === 'docs_foreign')?.metadata).toEqual({ emoji: '🔒' });
    expect(await listIds('custom')).toEqual([
      'docs_folder',
      'docs_page',
      'docs_backing',
      'docs_direct',
      'file_raw',
    ]);
  });
});
