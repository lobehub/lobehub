// @vitest-environment node
import { FileSource } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { DOCUMENT_FOLDER_TYPE, documents, files, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ElasticsearchFtsSearchBackend, type ElasticsearchFtsSearchClient } from '../elasticsearch';
import type { FtsSearchBackendRequest, FtsSearchFileResult, FtsSearchPageResult } from '../types';

const db: LobeChatDatabase = await getTestDB();

const userId = 'es-file-content-user';
const filler = 'Unrelated planning paragraph. '.repeat(15);

const createClient = (ids: string[]): ElasticsearchFtsSearchClient => ({
  search: vi.fn().mockResolvedValue({
    hits: { hits: ids.map((id, index) => ({ _id: id, _score: 10 - index })) },
  }),
});

const documentRequest = (
  documentKind: 'fileContent' | 'page',
  mode?: FtsSearchBackendRequest['mode'],
): FtsSearchBackendRequest => ({
  entity: 'documents',
  filters: { documentKind },
  mode,
  pagination: { limit: 5 },
  query: { text: 'kestrel' },
  scope: { userId },
});

const insertParsedFile = async (id: string, content: string, source?: FileSource) => {
  await db.insert(files).values({
    fileType: 'application/pdf',
    id,
    name: `${id}.pdf`,
    size: 10,
    source,
    url: `s3://bucket/${id}.pdf`,
    userId,
  });
  await db.insert(documents).values({
    content,
    fileId: id,
    fileType: 'application/pdf',
    filename: `${id}.pdf`,
    id: `doc-${id}`,
    source: `s3://bucket/${id}.pdf`,
    sourceType: 'file',
    totalCharCount: content.length,
    totalLineCount: 1,
    userId,
  });
};

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({ id: userId });
});

describe('ElasticsearchFtsSearchBackend file content', () => {
  it('queries parsed file documents by content only', async () => {
    const client = createClient([]);
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace: 'test' });

    await backend.search(documentRequest('fileContent', 'candidates'));

    const { body } = vi.mocked(client.search).mock.calls[0][0];
    expect(body.query.bool.filter).toContainEqual({ exists: { field: 'file_id' } });
    expect(body.query.bool.must_not).toContainEqual({
      terms: { file_type: ['custom/document', DOCUMENT_FOLDER_TYPE] },
    });
    expect(body.query.bool.must[0].multi_match.fields).toEqual(['content']);
  });

  it('hydrates document hits into their files with a snippet around the match', async () => {
    await insertParsedFile('es-fc-contract', `${filler}The kestrel clause covers renewals.`);
    const backend = new ElasticsearchFtsSearchBackend(db, {
      client: createClient(['doc-es-fc-contract']),
      indexNamespace: 'test',
    });

    const response = await backend.search(documentRequest('fileContent'));
    const items = response.items as FtsSearchFileResult[];

    expect(items.map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'es-fc-contract', type: 'file' },
    ]);
    expect(items[0].description).toContain('kestrel clause');
  });

  it('drops document hits whose file is hidden from the library', async () => {
    await insertParsedFile('es-fc-hidden', 'kestrel secret', FileSource.ToolResult);
    const backend = new ElasticsearchFtsSearchBackend(db, {
      client: createClient(['doc-es-fc-hidden']),
      indexNamespace: 'test',
    });

    const response = await backend.search(documentRequest('fileContent'));

    expect(response.items).toEqual([]);
  });

  it('shows where a page matched', async () => {
    await db.insert(documents).values({
      content: `${filler}The kestrel section explains the rollout.`,
      fileType: 'custom/document',
      filename: 'roadmap.md',
      id: 'es-fc-page',
      source: 'internal://es-fc-page',
      sourceType: 'file',
      title: 'Roadmap',
      totalCharCount: 100,
      totalLineCount: 1,
      userId,
    });
    const backend = new ElasticsearchFtsSearchBackend(db, {
      client: createClient(['es-fc-page']),
      indexNamespace: 'test',
    });

    const response = await backend.search(documentRequest('page'));
    const items = response.items as FtsSearchPageResult[];

    expect(items[0].description).toContain('kestrel section');
  });
});
