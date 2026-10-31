// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import type { LobeChatDatabase } from '../../../type';
import { ElasticsearchFtsSearchBackend, type ElasticsearchFtsSearchClient } from '../elasticsearch';
import type { FtsSearchBackendRequest } from '../types';

const db: LobeChatDatabase = await getTestDB();

const userId = 'es-time-range-user';
const start = new Date('2026-10-12T00:00:00.000Z');
const end = new Date('2026-10-18T23:59:59.000Z');

const createClient = (): ElasticsearchFtsSearchClient => ({
  search: vi.fn().mockResolvedValue({ hits: { hits: [] } }),
});

const candidates = (
  entity: FtsSearchBackendRequest['entity'],
  filters: FtsSearchBackendRequest['filters'],
): FtsSearchBackendRequest => ({
  entity,
  filters,
  mode: 'candidates',
  pagination: { limit: 10 },
  query: { text: 'kestrel' },
  scope: { userId },
});

const sentFilters = (client: ElasticsearchFtsSearchClient) =>
  vi.mocked(client.search).mock.calls[0][0].body.query.bool.filter;

describe('ElasticsearchFtsSearchBackend candidate filters', () => {
  it.each([
    ['messages', 'createdAt', 'created_at'],
    ['topics', 'updatedAt', 'updated_at'],
  ] as const)(
    'narrows %s candidates by %s inside the query',
    async (entity, field, documentField) => {
      const client = createClient();
      const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace: 'test' });

      await backend.search(candidates(entity, { timeRange: { end, field, start } }));

      expect(sentFilters(client)).toContainEqual({
        range: { [documentField]: { gte: start.toISOString(), lte: end.toISOString() } },
      });
    },
  );

  it('narrows page candidates and keeps an open edge open', async () => {
    const client = createClient();
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace: 'test' });

    await backend.search(
      candidates('documents', { documentKind: 'page', timeRange: { field: 'updatedAt', start } }),
    );

    expect(sentFilters(client)).toContainEqual({
      range: { updated_at: { gte: start.toISOString() } },
    });
  });

  it('ignores the window for entities without one', async () => {
    const client = createClient();
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace: 'test' });

    await backend.search(candidates('agents', { timeRange: { end, field: 'createdAt', start } }));

    expect(sentFilters(client).some((clause: object) => 'range' in clause)).toBe(false);
  });

  it('narrows message candidates to the requested roles and topic', async () => {
    const client = createClient();
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace: 'test' });

    await backend.search(
      candidates('messages', { messageScope: { roles: ['user', 'assistant'], topicId: 'tpc_x' } }),
    );

    expect(sentFilters(client)).toEqual(
      expect.arrayContaining([
        { terms: { role: ['user', 'assistant'] } },
        { term: { topic_id: 'tpc_x' } },
      ]),
    );
  });
});
