// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { documents, knowledgeBases, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ElasticsearchFtsSearchBackend } from '../elasticsearch';
import { FtsSearchRepo } from '../index';
import { PgLikeFtsSearchBackend } from '../pgLike';
import { PgSearchFtsSearchBackend } from '../pgSearch';

const isServerDB = process.env.TEST_SERVER_DB === '1';
const userId = 'kb-relaxed-user';
const knowledgeBaseId = 'kb-relaxed';
const serverDB: LobeChatDatabase = await getTestDB();

const insertDocument = (id: string, content: string) =>
  serverDB.insert(documents).values({
    content,
    fileType: 'custom/document',
    filename: id,
    id,
    knowledgeBaseId,
    source: `internal://${id}`,
    sourceType: 'file',
    title: id,
    totalCharCount: content.length,
    totalLineCount: 1,
    userId,
  });

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(knowledgeBases).values({ id: knowledgeBaseId, name: 'KB', userId });
});

const hit = (documentId: string) => ({
  documentId,
  knowledgeBaseId,
  relevance: 1,
  snippet: '',
  title: documentId,
  updatedAt: new Date(),
});

describe('knowledge base two-stage retrieval', () => {
  const repoWith = (search: ReturnType<typeof vi.fn>) =>
    new FtsSearchRepo(serverDB, userId, undefined, undefined, {
      backend: { key: 'fake', search },
    });

  it('keeps a strict hit and never runs the relaxed stage', async () => {
    const search = vi.fn().mockResolvedValue({ candidates: [], items: [hit('exact')] });

    const hits = await repoWith(search).searchKnowledgeBaseDocuments('a b', [knowledgeBaseId]);

    expect(search).toHaveBeenCalledTimes(1);
    expect(hits[0].partialMatch).toBeUndefined();
  });

  it('relaxes only an empty result and flags what it returns', async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce({ candidates: [], items: [] })
      .mockResolvedValueOnce({ candidates: [], items: [hit('near')] });

    const hits = await repoWith(search).searchKnowledgeBaseDocuments('a b', [knowledgeBaseId]);

    expect(search.mock.calls[0][0].query.minimumMatchRatio).toBeUndefined();
    expect(search.mock.calls[1][0].query.minimumMatchRatio).toBe(0.6);
    expect(hits).toMatchObject([{ documentId: 'near', partialMatch: true }]);
  });
});

describe('pg_like partial matching', () => {
  const repo = () =>
    new FtsSearchRepo(serverDB, userId, undefined, undefined, {
      backend: new PgLikeFtsSearchBackend(serverDB, { userId }),
    });

  it('ranks by how many terms a document contains and drops weak matches', async () => {
    await insertDocument('most', '住宿 标准 员工');
    await insertDocument('some', '住宿 标准');
    await insertDocument('one', '住宿');

    const hits = await repo().searchKnowledgeBaseDocuments('住宿 标准 员工 上限 每晚', [
      knowledgeBaseId,
    ]);

    expect(hits.map(({ documentId }) => documentId)).toEqual(['most']);
    expect(hits[0].partialMatch).toBe(true);
  });

  it('does not relax a single-term query', async () => {
    await insertDocument('other', '住宿');

    await expect(repo().searchKnowledgeBaseDocuments('报销', [knowledgeBaseId])).resolves.toEqual(
      [],
    );
  });
});

describe.skipIf(!isServerDB)('pg_search partial matching', () => {
  const repo = () =>
    new FtsSearchRepo(serverDB, userId, undefined, undefined, {
      backend: new PgSearchFtsSearchBackend(serverDB, { userId }),
    });

  it('finds a document for a multi-term query the strict stage rejects', async () => {
    await insertDocument(
      'policy',
      '一线城市（北京、上海）普通员工出差的住宿标准为每晚上限五百元。',
    );
    await insertDocument('unrelated', '公司食堂每周一更新菜单。');

    const hits = await repo().searchKnowledgeBaseDocuments('差旅费 住宿 标准 普通 员工', [
      knowledgeBaseId,
    ]);

    expect(hits.map(({ documentId }) => documentId)).toEqual(['policy']);
    expect(hits[0].partialMatch).toBe(true);
  });

  it('does not return a document sharing only one term', async () => {
    await insertDocument('one-term', '员工手册第一章。');

    await expect(
      repo().searchKnowledgeBaseDocuments('食堂 菜单 标准 员工', [knowledgeBaseId]),
    ).resolves.toEqual([]);
  });
});

describe('Elasticsearch partial matching', () => {
  it('asks for a share of the terms instead of all of them', async () => {
    const search = vi.fn().mockResolvedValue({ hits: { hits: [], total: { value: 0 } } });
    const backend = new ElasticsearchFtsSearchBackend(serverDB, {
      client: { search } as never,
      indexNamespace: 'test',
    });

    await backend.search({
      entity: 'documents',
      filters: { documentKind: 'knowledgeBaseDocument', knowledgeBaseIds: [knowledgeBaseId] },
      pagination: { limit: 5 },
      query: { minimumMatchRatio: 0.6, text: '住宿 标准' },
      scope: { userId },
    } as never);

    const multiMatch = search.mock.calls[0][0].body.query.bool.must[0].multi_match;
    expect(multiMatch).toMatchObject({ minimum_should_match: '60%', operator: 'or' });
  });
});
