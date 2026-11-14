// @vitest-environment node
import { SortType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { compareResourceItems } from '../../../../../../src/store/file/slices/resource/utils';
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

  it('matches client ordering for every numeric run, leading zeros and code points', async () => {
    const names = [
      'chapter 1 part 10',
      'chapter 1 part 2',
      '250509-1.10',
      '250509-1.2',
      '1',
      '01',
      '000',
      '0',
      '99999999999999999999',
      '100000000000000000000',
      '999999999999999999999',
      '1000000000000000000000',
      '第10章',
      '第2章',
      'Zebra',
      'apple',
      '\uE000',
      '😀',
    ];
    for (const [index, name] of names.entries()) await addDocument(`docs_${index}`, name);
    await addFile('file_pair', 'chapter 1 part 2');
    await addDocument('docs_\uE000', 'same');
    await addDocument('docs_😀', 'same');
    const rows = await repo.query({ knowledgeBaseId, limit: 100 });
    for (const sortType of [SortType.Asc, SortType.Desc]) {
      const expected = [...rows].sort((a, b) => compareResourceItems(a, b, 'name', sortType));
      expect(await listIds('name', sortType)).toEqual(expected.map((row) => row.id));
    }
    const ascending = await listIds('name');
    for (const [before, after] of [
      [1, 0],
      [3, 2],
      [5, 4],
      [8, 9],
      [10, 11],
      [13, 12],
    ]) {
      expect(ascending.indexOf(`docs_${before}`)).toBeLessThan(ascending.indexOf(`docs_${after}`));
    }
  });

  it.each(['custom', 'name', 'createdAt', 'size'] as const)(
    'matches client grouping and tie-breaking across library and Drive pages for %s',
    async (sorter) => {
      await addDocument('docs_folder', 'Z folder', { fileType: 'custom/folder' });
      await db.update(documents).set({ createdAt: new Date('2024-02-01T00:00:00Z') });
      await addFile('file_b', 'same');
      await addFile('file_a', 'same');
      await addFile('file_10', '10 file');
      await addFile('file_2', '2 file');

      for (const groupFolders of [true, false]) {
        if (!groupFolders) {
          await db.delete(knowledgeBaseFiles);
          await db.update(documents).set({ knowledgeBaseId: null });
        }
        for (const includeContent of [true, false]) {
          for (const sortType of [SortType.Asc, SortType.Desc]) {
            const params = {
              knowledgeBaseId: groupFolders ? knowledgeBaseId : undefined,
              includeContent,
              sorter,
              sortType,
            };
            const rows = await repo.query({ ...params, limit: 100 });
            const expected = [...rows].sort((a, b) =>
              compareResourceItems(a, b, sorter, sortType, { groupFolders }),
            );
            const ids: string[] = [];
            for (let offset = 0; offset < 5; offset += 2) {
              const page = await repo.query({ ...params, limit: 2, offset });
              ids.push(...page.map((item) => item.id));
            }
            expect(ids).toEqual(expected.map((item) => item.id));
            const foldersFirst = groupFolders || sorter === 'custom' || sorter === 'name';
            const folderIndex = ids.indexOf('docs_folder');
            expect(folderIndex).toBe(
              foldersFirst ||
                (sorter === 'size' ? sortType === SortType.Asc : sortType === SortType.Desc)
                ? 0
                : 4,
            );
          }
        }
      }
    },
  );

  it('moves one item across more than 1000 siblings without truncating the order', async () => {
    const ids = Array.from({ length: 1005 }, (_, i) => `docs_large_${i}`);
    await db.insert(documents).values(
      ids.map((id, i) => ({
        id,
        knowledgeBaseId,
        userId,
        title: `Item ${i}`,
        fileType: 'custom/document',
        source: 'internal://sorting',
        sourceType: 'topic',
        totalCharCount: 0,
        totalLineCount: 0,
      })),
    );
    expect(
      await repo.reorderItems({
        dragIds: [ids[1004]],
        knowledgeBaseId,
        parentId: null,
        position: 'before',
        targetId: ids[1],
        sorter: 'name',
        sortType: SortType.Asc,
      }),
    ).toEqual({ success: true });
    const rows = await repo.query({
      knowledgeBaseId,
      parentId: null,
      sorter: 'custom',
      limit: 2000,
    });
    expect(rows.map((row) => row.id)).toEqual([ids[0], ids[1004], ...ids.slice(1, 1004)]);
    expect(rows.map((row) => row.metadata?.sortOrder)).toEqual(ids.map((_, i) => (i + 1) * 1000));
  });

  it('renumbers unloaded siblings after a reordered descending first page', async () => {
    for (let n = 1; n <= 60; n++) {
      await addDocument(`docs_${n}`, `Item ${n}`, { metadata: { sortOrder: n * 1000 } });
    }
    const page = await repo.query({
      knowledgeBaseId,
      parentId: null,
      sorter: 'custom',
      sortType: SortType.Desc,
    });
    const orderedIds = page.map((item) => item.id);
    orderedIds.splice(1, 0, orderedIds.pop()!);
    await repo.reorderItems({
      knowledgeBaseId,
      dragIds: [page.at(-1)!.id],
      targetId: page[1].id,
      position: 'before',
      parentId: null,
      sorter: 'custom',
      sortType: SortType.Desc,
    });
    const all = await repo.query({
      knowledgeBaseId,
      parentId: null,
      sorter: 'custom',
      sortType: SortType.Asc,
      limit: 100,
    });
    expect(all.map((item) => item.id)).toEqual([
      ...orderedIds,
      ...Array.from({ length: 10 }, (_, i) => `docs_${10 - i}`),
    ]);
    expect(all.map((item) => item.metadata?.sortOrder)).toEqual(
      Array.from({ length: 60 }, (_, i) => (i + 1) * 1000),
    );
  });

  it.each([
    {
      dragIds: ['docs_b'],
      targetId: 'docs_f2',
      position: 'after',
      expected: ['docs_f1', 'docs_f2', 'docs_b', 'docs_a'],
    },
    {
      dragIds: ['docs_f1'],
      targetId: 'docs_a',
      position: 'before',
      expected: ['docs_f2', 'docs_f1', 'docs_a', 'docs_b'],
    },
    { dragIds: ['docs_b'], targetId: 'docs_f1', position: 'after', expected: null },
    { dragIds: ['docs_f1'], targetId: 'docs_b', position: 'before', expected: null },
    { dragIds: ['docs_a'], targetId: 'missing', position: 'before', expected: null },
    { dragIds: ['docs_a'], targetId: 'docs_a', position: 'before', expected: null },
    {
      dragIds: ['docs_f1', 'docs_b'],
      targetId: 'docs_a',
      position: 'before',
      expected: ['docs_f1', 'docs_f2', 'docs_b', 'docs_a'],
    },
    {
      dragIds: ['docs_b', 'docs_a', 'docs_f2'],
      targetId: 'docs_f1',
      position: 'before',
      expected: ['docs_f2', 'docs_f1', 'docs_a', 'docs_b'],
    },
  ] as const)(
    'applies boundary and group rules for $dragIds $position $targetId',
    async ({ dragIds, targetId, position, expected }) => {
      await addDocument('docs_f1', 'Folder 1', { fileType: 'custom/folder' });
      await addDocument('docs_f2', 'Folder 2', { fileType: 'custom/folder' });
      await addDocument('docs_a', 'A');
      await addDocument('docs_b', 'B');
      const before = await db.select().from(documents);
      expect(
        await repo.reorderItems({
          knowledgeBaseId,
          parentId: null,
          dragIds: [...dragIds],
          targetId,
          position,
          sorter: 'name',
          sortType: SortType.Asc,
        }),
      ).toEqual({ success: true });
      if (expected) expect(await listIds('custom')).toEqual(expected);
      else expect(await db.select().from(documents)).toEqual(before);
    },
  );

  it('normalizes paired IDs and keeps complete folder and file groups', async () => {
    await addDocument('docs_folder_a', 'Folder A', { fileType: 'custom/folder' });
    await addDocument('docs_folder_b', 'Folder B', { fileType: 'custom/folder' });
    await addFile('file_pair', 'Pair');
    await addDocument('docs_pair', 'Pair page', { fileId: 'file_pair' });
    await addFile('file_unloaded', 'Unloaded');
    await addDocument('docs_outside', 'Outside');
    await db
      .update(documents)
      .set({ parentId: 'docs_folder_a' })
      .where(eq(documents.id, 'docs_outside'));
    await repo.reorderItems({
      knowledgeBaseId,
      dragIds: ['docs_pair', 'file_pair', 'docs_outside'],
      targetId: 'docs_folder_b',
      position: 'after',
      parentId: null,
      sorter: 'name',
      sortType: SortType.Asc,
    });
    const rows = await repo.query({
      knowledgeBaseId,
      parentId: null,
      sorter: 'custom',
      sortType: SortType.Asc,
    });
    expect(rows.map((item) => item.id)).toEqual([
      'docs_folder_a',
      'docs_folder_b',
      'docs_pair',
      'file_unloaded',
    ]);
    expect(rows.map((item) => item.metadata?.sortOrder)).toEqual([1000, 2000, 3000, 4000]);
    const [outside] = await db.select().from(documents).where(eq(documents.id, 'docs_outside'));
    expect(outside.metadata?.sortOrder).toBeUndefined();
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

    expect(
      await repo.reorderItems({
        knowledgeBaseId: 'foreign-kb',
        dragIds: ['docs_owned'],
        targetId: 'file_owned',
        position: 'before',
        parentId: null,
      }),
    ).toEqual({
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

    await repo.reorderItems({
      knowledgeBaseId,
      dragIds: ['docs_unlinked', 'file_unlinked'],
      targetId: 'file_foreign',
      position: 'before',
      parentId: null,
    });

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
      await repo.reorderItems({
        knowledgeBaseId,
        parentId: null,
        targetId: 'docs_folder',
        position: 'after',
        dragIds: [
          'docs_page',
          'docs_page',
          'docs_backing',
          'file_direct',
          'file_raw',
          'docs_foreign',
        ],
      }),
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
