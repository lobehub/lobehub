import { FileSource } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { documents, files, knowledgeBaseFiles, knowledgeBases, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import type { FtsSearchRepo } from '../index';
import type { FtsSearchFileResult, FtsSearchPageResult } from '../types';

const userId = 'file-content-search-user';
const otherUserId = 'file-content-search-other-user';

export interface FtsSearchFileContentBehaviorOptions {
  createRepo: (db: LobeChatDatabase, userId: string) => FtsSearchRepo;
  db: LobeChatDatabase;
}

const filler = 'Quarterly planning notes and unrelated paragraphs. '.repeat(12);

/**
 * Provider-neutral behaviour for searching the parsed text of uploaded files
 * and showing where a page or file matched.
 */
export const describeFtsSearchFileContentBehavior = ({
  createRepo,
  db,
}: FtsSearchFileContentBehaviorOptions) => {
  describe('search - file content', () => {
    let repo: FtsSearchRepo;

    const insertFile = async (
      id: string,
      name: string,
      content: string | null,
      options: { ownerId?: string; source?: FileSource } = {},
    ) => {
      const ownerId = options.ownerId ?? userId;
      await db.insert(files).values({
        fileType: 'application/pdf',
        id,
        name,
        size: 1024,
        source: options.source,
        url: `s3://bucket/${id}.pdf`,
        userId: ownerId,
      });
      if (content === null) return;
      await db.insert(documents).values({
        content,
        fileId: id,
        fileType: 'custom/document',
        filename: name,
        id: `doc-${id}`,
        source: `s3://bucket/${id}.pdf`,
        sourceType: 'file',
        title: name,
        totalCharCount: content.length,
        totalLineCount: 1,
        userId: ownerId,
      });
    };

    const searchFiles = async (query: string, limitPerType?: number) =>
      (await repo.search({ limitPerType, query, type: 'file' })) as FtsSearchFileResult[];

    beforeEach(async () => {
      await db.delete(users);
      await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
      repo = createRepo(db, userId);
    });

    it('finds a file whose parsed text matches when its name does not', async () => {
      await insertFile(
        'fc-contract',
        'contract-2026.pdf',
        `${filler}The kestrel clause covers renewals.`,
      );
      await insertFile('fc-other', 'budget.pdf', filler);

      const results = await searchFiles('kestrel');

      expect(results.map(({ id }) => id)).toEqual(['fc-contract']);
      expect(results[0]).toMatchObject({ name: 'contract-2026.pdf', type: 'file' });
      expect(results[0].description).toContain('kestrel clause');
    });

    it('also returns content matches in an untyped search', async () => {
      await insertFile('fc-untyped', 'scan-001.pdf', 'Notes about the kestrel launch');

      const results = await repo.search({ query: 'kestrel' });

      expect(results.filter(({ type }) => type === 'file').map(({ id }) => id)).toEqual([
        'fc-untyped',
      ]);
    });

    it('lists name matches before content-only matches', async () => {
      await insertFile('fc-by-content', 'notes.pdf', 'kestrel kestrel kestrel kestrel');
      await insertFile('fc-by-name', 'kestrel-brief.pdf', filler);

      const results = await searchFiles('kestrel');

      expect(results.map(({ id }) => id)).toEqual(['fc-by-name', 'fc-by-content']);
    });

    it('returns a file once when both its name and its text match', async () => {
      await insertFile('fc-both', 'kestrel-report.pdf', `${filler}Kestrel figures for the quarter`);

      const results = await searchFiles('kestrel');

      expect(results.map(({ id }) => id)).toEqual(['fc-both']);
      expect(results[0].description).toContain('Kestrel figures');
    });

    it('respects the per-type limit across name and content matches', async () => {
      await insertFile('fc-limit-name', 'kestrel-a.pdf', filler);
      await insertFile('fc-limit-content-1', 'a.pdf', 'kestrel one');
      await insertFile('fc-limit-content-2', 'b.pdf', 'kestrel two');

      const results = await searchFiles('kestrel', 2);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('fc-limit-name');
    });

    it('does not reveal content matches from files hidden from the library', async () => {
      await insertFile('fc-hidden', 'tool-output.pdf', 'kestrel secret', {
        source: FileSource.ToolResult,
      });

      expect(await searchFiles('kestrel')).toEqual([]);
    });

    it('does not reveal content matches from another user', async () => {
      await insertFile('fc-foreign', 'theirs.pdf', 'kestrel secret', { ownerId: otherUserId });

      expect(await searchFiles('kestrel')).toEqual([]);
    });

    it('does not reveal content matches from restricted knowledge bases', async () => {
      await insertFile('fc-restricted', 'restricted.pdf', 'kestrel secret');
      await insertFile('fc-open', 'open.pdf', 'kestrel public');
      await db
        .insert(knowledgeBases)
        .values({ id: 'fc-kb-restricted', name: 'Restricted', userId });
      await db
        .insert(knowledgeBaseFiles)
        .values({ fileId: 'fc-restricted', knowledgeBaseId: 'fc-kb-restricted', userId });

      const results = await repo.search({
        excludeKnowledgeBaseIds: ['fc-kb-restricted'],
        query: 'kestrel',
        type: 'file',
      });

      expect(results.map(({ id }) => id)).toEqual(['fc-open']);
    });

    it('lists a parsed upload as its file, not as a page', async () => {
      await insertFile('fc-parsed', 'handbook.pdf', 'The kestrel policy applies to every team.');

      const results = await repo.search({ query: 'kestrel' });

      expect(results.map(({ id, type }) => ({ id, type }))).toEqual([
        { id: 'fc-parsed', type: 'file' },
      ]);
    });

    it('keeps parsed uploads in page-only searches such as recall', async () => {
      await insertFile('fc-recall', 'handbook.pdf', 'The kestrel policy applies to every team.');

      const results = await repo.search({ query: 'kestrel', type: 'page' });

      expect(results.map(({ id, type }) => ({ id, type }))).toEqual([
        { id: 'doc-fc-recall', type: 'page' },
      ]);
    });

    it('still finds legacy parsed rows stored with the upload mime type', async () => {
      await insertFile('fc-legacy', 'legacy.pdf', null);
      await db.insert(documents).values({
        content: 'Legacy kestrel notes',
        fileId: 'fc-legacy',
        fileType: 'application/pdf',
        filename: 'legacy.pdf',
        id: 'doc-fc-legacy',
        source: 's3://bucket/fc-legacy.pdf',
        sourceType: 'file',
        totalCharCount: 20,
        totalLineCount: 1,
        userId,
      });

      expect((await searchFiles('kestrel')).map(({ id }) => id)).toEqual(['fc-legacy']);
    });

    it('keeps a knowledge base page with its mirror file a page', async () => {
      await db.insert(knowledgeBases).values({ id: 'fc-kb-pages', name: 'Pages', userId });
      await db.insert(files).values({
        fileType: 'custom/document',
        id: 'fc-mirror',
        name: 'Rollout notes',
        size: 10,
        url: 'internal://document/placeholder',
        userId,
      });
      await db.insert(documents).values({
        content: 'Rollout notes about kestrel',
        fileId: 'fc-mirror',
        fileType: 'custom/document',
        filename: 'Rollout notes',
        id: 'fc-kb-page',
        knowledgeBaseId: 'fc-kb-pages',
        source: 'internal://document/placeholder',
        sourceType: 'api',
        title: 'Rollout notes',
        totalCharCount: 27,
        totalLineCount: 1,
        userId,
      });

      const results = await repo.search({ query: 'kestrel' });

      expect(results.map(({ id, type }) => ({ id, type }))).toEqual([
        { id: 'fc-kb-page', type: 'page' },
      ]);
    });

    it('shows where a page matched', async () => {
      await db.insert(documents).values({
        content: `${filler}The kestrel section explains the rollout.`,
        fileType: 'custom/document',
        filename: 'roadmap.md',
        id: 'fc-page',
        source: 'internal://fc-page',
        sourceType: 'api',
        title: 'Roadmap',
        totalCharCount: 100,
        totalLineCount: 1,
        userId,
      });

      const results = (await repo.search({
        query: 'kestrel',
        type: 'page',
      })) as FtsSearchPageResult[];

      expect(results.map(({ id }) => id)).toEqual(['fc-page']);
      expect(results[0].description).toContain('kestrel section');
    });
  });
};
