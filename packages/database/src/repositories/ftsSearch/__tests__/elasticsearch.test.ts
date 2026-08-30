// @vitest-environment node
import { FileSource } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agents,
  chatGroups,
  DOCUMENT_FOLDER_TYPE,
  documents,
  files,
  knowledgeBaseFiles,
  knowledgeBases,
  messages,
  sessions,
  topics,
  userMemories,
  users,
  workspaces,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ElasticsearchFtsSearchBackend, type ElasticsearchFtsSearchClient } from '../elasticsearch';
import type {
  FtsSearchBackendFilters,
  FtsSearchBackendRequest,
  FtsSearchBackendScope,
} from '../types';

const db: LobeChatDatabase = await getTestDB();

const userId = 'es-search-user';
const otherUserId = 'es-search-other-user';
const workspaceId = 'es-search-workspace';
const otherWorkspaceId = 'es-search-other-workspace';
const indexNamespace = 'lobehub-dev';

const request = (
  entity: FtsSearchBackendRequest['entity'],
  options: {
    agentId?: string;
    filters?: Partial<FtsSearchBackendFilters>;
    limit?: number;
    query?: string;
    scope?: Partial<FtsSearchBackendScope>;
  } = {},
): FtsSearchBackendRequest => ({
  entity,
  filters: { agentId: options.agentId, ...options.filters },
  pagination: { limit: options.limit ?? 5 },
  query: { text: options.query ?? 'search phrase' },
  scope: {
    userId,
    workspaceId,
    ...options.scope,
  },
});

const createClient = (
  hits: Array<{ _id: string; _score: number | null }>,
): ElasticsearchFtsSearchClient => ({
  search: vi.fn().mockResolvedValue({ hits: { hits } }),
});

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await db.insert(workspaces).values([
    {
      id: workspaceId,
      name: 'Search Workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    },
    {
      id: otherWorkspaceId,
      name: 'Other Search Workspace',
      primaryOwnerId: otherUserId,
      slug: otherWorkspaceId,
    },
  ]);
});

afterEach(async () => {
  await db.delete(users);
});

describe('ElasticsearchFtsSearchBackend', () => {
  it('searches and reauthorizes unified user-memory candidates in PostgreSQL', async () => {
    await db.insert(userMemories).values([
      {
        id: 'memory-own',
        lastAccessedAt: new Date(),
        memoryLayer: 'context',
        title: 'Own memory',
        userId,
      },
      {
        id: 'memory-other',
        lastAccessedAt: new Date(),
        memoryLayer: 'context',
        title: 'Other memory',
        userId: otherUserId,
      },
    ]);
    const client = createClient([
      { _id: 'memory-other', _score: 12 },
      { _id: 'memory-deleted', _score: 10 },
      { _id: 'memory-own', _score: 8 },
    ]);
    const operations: string[] = [];
    const observer = {
      observe: async <Result>(
        _entity: string,
        operation: string,
        callback: () => Promise<Result>,
      ) => {
        operations.push(operation);
        return callback();
      },
    };
    const backend = new ElasticsearchFtsSearchBackend(db, {
      client,
      indexNamespace,
      observer,
    });

    const response = await backend.search(
      request('userMemories', { scope: { workspaceId: undefined } }),
    );

    expect(response.items).toEqual([
      expect.objectContaining({ id: 'memory-own', memoryLayer: 'context', type: 'memory' }),
    ]);
    expect(operations).toEqual(['candidate_query', 'pg_hydration']);
    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          query: {
            bool: expect.objectContaining({
              filter: [{ term: { user_id: userId } }],
              must: [
                {
                  multi_match: {
                    fields: ['title^4', 'summary^2', 'details'],
                    operator: 'and',
                    query: 'search phrase',
                    type: 'best_fields',
                  },
                },
              ],
            }),
          },
        }),
        entity: 'userMemories',
        index: 'lobehub-dev-user-memories',
        pagination: 'bounded',
      }),
    );
  });

  it('builds exact memory-layer candidate filters without hydrating index documents', async () => {
    const client = createClient([{ _id: 'context-1', _score: 7 }]);
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace });

    const response = await backend.search({
      entity: 'memoryContexts',
      filters: {
        memoryCategories: ['project'],
        memoryStatus: ['active'],
        memoryTags: ['typescript', 'search'],
        memoryTimeRange: {
          end: new Date('2026-08-27T00:00:00.000Z'),
          start: new Date('2026-08-20T00:00:00.000Z'),
        },
        memoryTypes: ['workflow'],
      },
      mode: 'candidates',
      pagination: { limit: 3 },
      query: {
        fields: ['parent_text', 'title', 'description', 'current_status'],
        text: 'search-phrase',
      },
      scope: { userId },
    });

    expect(response).toEqual({
      candidates: [{ id: 'context-1', score: 7 }],
      items: [],
      total: 1,
    });
    expect(client.search).toHaveBeenCalledWith({
      body: {
        _source: false,
        query: {
          bool: {
            filter: [
              { term: { user_id: userId } },
              {
                bool: {
                  minimum_should_match: 1,
                  should: [
                    { terms: { parent_memory_categories: ['project'] } },
                    {
                      bool: {
                        must_not: [{ exists: { field: 'parent_memory_categories' } }],
                      },
                    },
                  ],
                },
              },
              { terms: { type: ['workflow'] } },
              { terms: { 'current_status.raw': ['active'] } },
              {
                bool: {
                  minimum_should_match: 1,
                  should: [
                    { term: { tags: 'typescript' } },
                    { term: { parent_tags: 'typescript' } },
                    { bool: { must_not: [{ exists: { field: 'parent_tags' } }] } },
                  ],
                },
              },
              {
                bool: {
                  minimum_should_match: 1,
                  should: [
                    { term: { tags: 'search' } },
                    { term: { parent_tags: 'search' } },
                    { bool: { must_not: [{ exists: { field: 'parent_tags' } }] } },
                  ],
                },
              },
              {
                range: {
                  captured_at: {
                    gte: '2026-08-20T00:00:00.000Z',
                    lte: '2026-08-27T00:00:00.000Z',
                  },
                },
              },
            ],
            must: [
              {
                multi_match: {
                  fields: ['parent_text', 'title', 'description', 'current_status'],
                  operator: 'and',
                  query: 'search phrase',
                  type: 'best_fields',
                },
              },
            ],
            must_not: [{ term: { fts_search_sync_deleted: true } }],
          },
        },
        size: 12,
        sort: [{ _score: 'desc' }, { id: 'asc' }],
        track_total_hits: true,
      },
      entity: 'memoryContexts',
      index: 'lobehub-dev-memory-contexts',
      pagination: 'bounded',
    });
  });

  it('preserves the any-tag contract for legacy memory lists', async () => {
    const client = createClient([]);
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace });

    await backend.search({
      entity: 'memoryActivities',
      filters: {
        memoryTagMatch: 'any',
        memoryTags: ['typescript', 'search'],
      },
      mode: 'candidates',
      pagination: { limit: 3 },
      query: { text: 'candidate' },
      scope: { userId },
    });

    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          query: {
            bool: expect.objectContaining({
              filter: [
                { term: { user_id: userId } },
                {
                  bool: {
                    minimum_should_match: 1,
                    should: [
                      {
                        bool: {
                          minimum_should_match: 1,
                          should: [
                            { term: { tags: 'typescript' } },
                            { term: { parent_tags: 'typescript' } },
                            { bool: { must_not: [{ exists: { field: 'parent_tags' } }] } },
                          ],
                        },
                      },
                      {
                        bool: {
                          minimum_should_match: 1,
                          should: [
                            { term: { tags: 'search' } },
                            { term: { parent_tags: 'search' } },
                            { bool: { must_not: [{ exists: { field: 'parent_tags' } }] } },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          },
        }),
      }),
    );
  });

  it('rejects message topic scope when PostgreSQL parent filtering is unavailable', async () => {
    const client = createClient([]);
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace });

    await expect(
      backend.search({
        entity: 'messages',
        filters: { topicScope: { groupId: 'group-1' } },
        pagination: { limit: 5 },
        query: { text: 'scoped message' },
        scope: { userId, workspaceId },
      }),
    ).rejects.toThrow('Elasticsearch message topic scope requires candidate-only search');
    expect(client.search).not.toHaveBeenCalled();
  });

  it('applies topic scope only where the indexed document owns the scope fields', async () => {
    const client = createClient([]);
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace });

    await backend.search({
      entity: 'topics',
      filters: { topicScope: { agentId: 'agent-1' } },
      mode: 'candidates',
      pagination: {},
      query: { fields: ['title'], text: 'legacy topic' },
      scope: { userId, workspaceId },
    });
    await backend.search({
      entity: 'topics',
      filters: { topicScope: { groupId: 'group-1' } },
      mode: 'candidates',
      pagination: {},
      query: { fields: ['title'], text: 'legacy topic' },
      scope: { userId, workspaceId },
    });
    await backend.search({
      entity: 'topics',
      filters: { topicScope: { containerId: 'container-1' } },
      mode: 'candidates',
      pagination: {},
      query: { fields: ['title'], text: 'legacy topic' },
      scope: { userId, workspaceId },
    });
    await backend.search({
      entity: 'messages',
      filters: { topicScope: { groupId: 'group-1' } },
      mode: 'candidates',
      pagination: {},
      query: { fields: ['content'], text: 'legacy message' },
      scope: { userId, workspaceId },
    });
    await backend.search({
      entity: 'messages',
      filters: { topicScope: { agentId: 'agent-1' } },
      mode: 'candidates',
      pagination: {},
      query: { fields: ['content'], text: 'legacy message' },
      scope: { userId, workspaceId },
    });
    await backend.search({
      entity: 'messages',
      filters: { topicScope: { containerId: 'container-1' } },
      mode: 'candidates',
      pagination: {},
      query: { fields: ['content'], text: 'legacy message' },
      scope: { userId, workspaceId },
    });

    expect(client.search).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        body: expect.objectContaining({
          query: {
            bool: expect.objectContaining({
              filter: [{ term: { workspace_id: workspaceId } }, { term: { agent_id: 'agent-1' } }],
              must: [
                {
                  multi_match: {
                    fields: ['title'],
                    operator: 'and',
                    query: 'legacy topic',
                    type: 'best_fields',
                  },
                },
              ],
            }),
          },
        }),
        entity: 'topics',
        index: 'lobehub-dev-topics',
        pagination: 'unbounded',
      }),
    );
    expect(client.search).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        body: expect.objectContaining({
          query: {
            bool: expect.objectContaining({
              filter: [{ term: { workspace_id: workspaceId } }, { term: { group_id: 'group-1' } }],
            }),
          },
        }),
        entity: 'topics',
      }),
    );
    expect(client.search).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        body: expect.objectContaining({
          query: {
            bool: expect.objectContaining({
              filter: [
                { term: { workspace_id: workspaceId } },
                {
                  bool: {
                    minimum_should_match: 1,
                    should: [
                      { term: { session_id: 'container-1' } },
                      { term: { group_id: 'container-1' } },
                    ],
                  },
                },
              ],
            }),
          },
        }),
        entity: 'topics',
      }),
    );
    expect(client.search).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        body: expect.objectContaining({
          query: {
            bool: expect.objectContaining({
              filter: [
                { term: { workspace_id: workspaceId } },
                {
                  bool: {
                    minimum_should_match: 1,
                    should: [
                      { term: { group_id: 'group-1' } },
                      { bool: { must_not: [{ exists: { field: 'group_id' } }] } },
                    ],
                  },
                },
              ],
              must_not: [{ term: { fts_search_sync_deleted: true } }],
            }),
          },
        }),
        entity: 'messages',
        index: 'lobehub-dev-messages',
        pagination: 'unbounded',
      }),
    );
    expect(client.search).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        body: expect.objectContaining({
          query: {
            bool: expect.objectContaining({
              filter: [
                { term: { workspace_id: workspaceId } },
                {
                  bool: {
                    minimum_should_match: 1,
                    should: [
                      { term: { agent_id: 'agent-1' } },
                      { bool: { must_not: [{ exists: { field: 'agent_id' } }] } },
                    ],
                  },
                },
              ],
            }),
          },
        }),
        entity: 'messages',
      }),
    );
    expect(client.search).toHaveBeenNthCalledWith(
      6,
      expect.objectContaining({
        body: expect.objectContaining({
          query: {
            bool: expect.objectContaining({
              filter: [
                { term: { workspace_id: workspaceId } },
                {
                  bool: {
                    minimum_should_match: 1,
                    should: [
                      { term: { session_id: 'container-1' } },
                      { term: { group_id: 'container-1' } },
                      {
                        bool: {
                          must_not: [
                            { exists: { field: 'session_id' } },
                            { exists: { field: 'group_id' } },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          },
        }),
        entity: 'messages',
      }),
    );
  });

  it('paginates unbounded legacy candidates with search_after', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      _id: `topic-${index.toString().padStart(4, '0')}`,
      _score: 1000 - index,
      sort: [1000 - index, `topic-${index.toString().padStart(4, '0')}`],
    }));
    const client: ElasticsearchFtsSearchClient = {
      search: vi
        .fn()
        .mockResolvedValueOnce({ hits: { hits: firstPage, total: { value: 1001 } } })
        .mockResolvedValueOnce({
          hits: {
            hits: [{ _id: 'topic-final', _score: 0, sort: [0, 'topic-final'] }],
            total: { value: 1001 },
          },
        }),
    };
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace });

    const response = await backend.search({
      entity: 'topics',
      filters: {},
      mode: 'candidates',
      pagination: {},
      query: { fields: ['title'], text: 'legacy topic' },
      scope: { userId },
    });

    expect(response.candidates).toHaveLength(1001);
    expect(response.total).toBe(1001);
    expect(client.search).toHaveBeenCalledTimes(2);
    expect(client.search).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ entity: 'topics', pagination: 'unbounded' }),
    );
    expect(client.search).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        body: expect.not.objectContaining({
          track_total_hits: true,
        }),
      }),
    );
    expect(client.search).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        body: expect.objectContaining({ search_after: firstPage.at(-1)?.sort }),
      }),
    );
  });

  it('queries weighted agent fields and rechecks workspace visibility during hydration', async () => {
    await db.insert(agents).values([
      {
        id: 'agent-public',
        title: 'Public workspace agent',
        userId: otherUserId,
        visibility: 'public',
        workspaceId,
      },
      {
        id: 'agent-private-own',
        title: 'Own private workspace agent',
        userId,
        visibility: 'private',
        workspaceId,
      },
      {
        id: 'agent-legacy-public',
        title: 'Legacy public workspace agent',
        userId: otherUserId,
        visibility: 'public',
        workspaceId,
      },
      {
        id: 'agent-private-other',
        title: 'Other private workspace agent',
        userId: otherUserId,
        visibility: 'private',
        workspaceId,
      },
    ]);
    const client = createClient([
      { _id: 'agent-private-other', _score: 12 },
      { _id: 'agent-legacy-public', _score: 11 },
      { _id: 'agent-public', _score: 10 },
      { _id: 'agent-private-own', _score: 8 },
      { _id: 'agent-deleted', _score: 7 },
    ]);
    const backend = new ElasticsearchFtsSearchBackend(db, {
      client,
      indexNamespace,
    });

    const response = await backend.search(request('agents'));

    expect(response.candidates).toEqual([
      { id: 'agent-private-other', score: 12 },
      { id: 'agent-legacy-public', score: 11 },
      { id: 'agent-public', score: 10 },
      { id: 'agent-private-own', score: 8 },
      { id: 'agent-deleted', score: 7 },
    ]);
    expect(response.items).toEqual([
      expect.objectContaining({ id: 'agent-legacy-public' }),
      expect.objectContaining({ id: 'agent-public' }),
      expect.objectContaining({ id: 'agent-private-own' }),
    ]);
    expect(client.search).toHaveBeenCalledWith({
      body: {
        _source: false,
        query: {
          bool: {
            filter: [
              { term: { workspace_id: workspaceId } },
              {
                bool: {
                  minimum_should_match: 1,
                  should: [
                    { bool: { must_not: [{ exists: { field: 'visibility' } }] } },
                    { term: { visibility: 'public' } },
                    { term: { user_id: userId } },
                  ],
                },
              },
            ],
            must: [
              {
                multi_match: {
                  fields: ['title^5', 'slug^4', 'tags^3', 'description^2', 'system_role'],
                  operator: 'and',
                  query: 'search phrase',
                  type: 'best_fields',
                },
              },
            ],
            must_not: [{ term: { fts_search_sync_deleted: true } }],
          },
        },
        size: 20,
        sort: [{ _score: 'desc' }, { id: 'asc' }],
      },
      entity: 'agents',
      index: 'lobehub-dev-agents',
      pagination: 'bounded',
    });

    const publicCaller = await backend.search(
      request('agents', { scope: { callerAgentVisibility: 'public' } }),
    );
    expect(publicCaller.items).toEqual([
      expect.objectContaining({ id: 'agent-legacy-public' }),
      expect.objectContaining({ id: 'agent-public' }),
    ]);
  });

  it('searches chat-group content while personal hydration blocks workspace and stale hits', async () => {
    await db.insert(chatGroups).values([
      {
        content: 'Deep planning notes',
        id: 'group-personal',
        title: 'Personal group',
        userId,
      },
      {
        content: 'Deep workspace notes',
        id: 'group-workspace',
        title: 'Workspace group',
        userId,
        workspaceId,
      },
    ]);
    const client = createClient([
      { _id: 'group-workspace', _score: 9 },
      { _id: 'group-personal', _score: 7 },
      { _id: 'group-deleted', _score: 6 },
    ]);
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace });

    const response = await backend.search(
      request('chatGroups', { scope: { workspaceId: undefined } }),
    );

    expect(response.items).toEqual([expect.objectContaining({ id: 'group-personal' })]);
    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          query: {
            bool: expect.objectContaining({
              filter: [{ term: { user_id: userId } }],
              must: [
                {
                  multi_match: {
                    fields: ['title^4', 'description^2', 'content'],
                    operator: 'and',
                    query: 'search phrase',
                    type: 'best_fields',
                  },
                },
              ],
              must_not: [
                { exists: { field: 'workspace_id' } },
                { term: { fts_search_sync_deleted: true } },
              ],
            }),
          },
        }),
        entity: 'chatGroups',
        index: 'lobehub-dev-chat-groups',
        pagination: 'bounded',
      }),
    );
  });

  it('reranks topic candidates by recency and blocks invisible parent containers', async () => {
    await db.insert(agents).values([
      {
        id: 'topic-agent-public',
        title: 'Public topic agent',
        userId: otherUserId,
        visibility: 'public',
        workspaceId,
      },
      {
        id: 'topic-agent-private',
        title: 'Private topic agent',
        userId: otherUserId,
        visibility: 'private',
        workspaceId,
      },
    ]);
    await db.insert(chatGroups).values([
      {
        id: 'topic-group-public',
        title: 'Public topic group',
        userId: otherUserId,
        visibility: 'public',
        workspaceId,
      },
      {
        id: 'topic-group-private',
        title: 'Private topic group',
        userId: otherUserId,
        visibility: 'private',
        workspaceId,
      },
    ]);
    await db.insert(sessions).values({
      id: 'topic-session',
      title: 'Topic session',
      userId: otherUserId,
      workspaceId,
    });
    await db.insert(topics).values([
      {
        agentId: 'topic-agent-public',
        groupId: 'topic-group-public',
        id: 'topic-old',
        sessionId: 'topic-session',
        title: 'Older relevant topic',
        updatedAt: new Date('2026-08-20T00:00:00.000Z'),
        userId,
        workspaceId,
      },
      {
        agentId: 'topic-agent-public',
        groupId: 'topic-group-public',
        id: 'topic-recent',
        sessionId: 'topic-session',
        title: 'Recent relevant topic',
        updatedAt: new Date('2026-08-25T00:00:00.000Z'),
        userId,
        workspaceId,
      },
      {
        agentId: 'topic-agent-private',
        id: 'topic-private-agent',
        title: 'Private parent agent topic',
        userId,
        workspaceId,
      },
      {
        groupId: 'topic-group-private',
        id: 'topic-private-group',
        title: 'Private parent group topic',
        userId,
        workspaceId,
      },
    ]);
    const client = createClient([
      { _id: 'topic-old', _score: 12 },
      { _id: 'topic-private-agent', _score: 11 },
      { _id: 'topic-private-group', _score: 10 },
      { _id: 'topic-recent', _score: 8 },
    ]);
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace });

    const response = await backend.search(request('topics', { limit: 2 }));

    expect(response.items).toEqual([
      expect.objectContaining({ id: 'topic-recent' }),
      expect.objectContaining({ id: 'topic-old' }),
    ]);
    expect(response.items[0]).toMatchObject({
      agentId: 'topic-agent-public',
      groupId: 'topic-group-public',
      sessionId: 'topic-session',
    });

    await backend.search(request('topics', { agentId: 'topic-agent-public', limit: 2 }));
    expect(client.search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          query: {
            bool: expect.objectContaining({
              filter: expect.arrayContaining([{ term: { agent_id: 'topic-agent-public' } }]),
            }),
          },
        }),
      }),
    );
  });

  it('continues topic candidates after parent authorization empties the first page', async () => {
    await db.insert(agents).values([
      {
        id: 'paging-agent-private',
        title: 'Private paging agent',
        userId: otherUserId,
        visibility: 'private',
        workspaceId,
      },
      {
        id: 'paging-agent-public',
        title: 'Public paging agent',
        userId: otherUserId,
        visibility: 'public',
        workspaceId,
      },
    ]);
    const privateTopics = Array.from({ length: 7 }, (_, index) => ({
      agentId: 'paging-agent-private',
      id: `paging-private-${index}`,
      title: `Private match ${index}`,
      userId: otherUserId,
      workspaceId,
    }));
    await db.insert(topics).values([
      ...privateTopics,
      {
        agentId: 'paging-agent-public',
        id: 'paging-visible-old',
        title: 'Visible older match',
        updatedAt: new Date('2026-08-20T00:00:00.000Z'),
        userId,
        workspaceId,
      },
      {
        agentId: 'paging-agent-public',
        id: 'paging-visible-recent',
        title: 'Visible recent match',
        updatedAt: new Date('2026-08-25T00:00:00.000Z'),
        userId,
        workspaceId,
      },
    ]);
    const firstPage = [
      ...privateTopics.map(({ id }, index) => ({
        _id: id,
        _score: 20 - index,
        sort: [20 - index, id],
      })),
      { _id: 'paging-visible-old', _score: 10, sort: [10, 'paging-visible-old'] },
    ];
    const client: ElasticsearchFtsSearchClient = {
      search: vi
        .fn()
        .mockResolvedValueOnce({ hits: { hits: firstPage } })
        .mockResolvedValueOnce({
          hits: {
            hits: [{ _id: 'paging-visible-recent', _score: 9 }],
          },
        }),
    };
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace });

    const response = await backend.search(request('topics', { limit: 2 }));

    expect(response.items).toEqual([
      expect.objectContaining({ id: 'paging-visible-recent' }),
      expect.objectContaining({ id: 'paging-visible-old' }),
    ]);
    expect(client.search).toHaveBeenCalledTimes(2);
    expect(client.search).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        body: expect.objectContaining({ search_after: firstPage.at(-1)?.sort }),
        pagination: 'bounded',
      }),
    );
  });

  it('continues message candidates after parent authorization empties the first page', async () => {
    await db.insert(agents).values([
      {
        id: 'message-paging-agent-private',
        title: 'Private message paging agent',
        userId: otherUserId,
        visibility: 'private',
        workspaceId,
      },
      {
        id: 'message-paging-agent-public',
        title: 'Public message paging agent',
        userId: otherUserId,
        visibility: 'public',
        workspaceId,
      },
    ]);
    const privateMessages = Array.from({ length: 8 }, (_, index) => ({
      agentId: 'message-paging-agent-private',
      content: `Private message match ${index}`,
      id: `message-paging-private-${index}`,
      role: 'assistant' as const,
      userId: otherUserId,
      workspaceId,
    }));
    await db.insert(messages).values([
      ...privateMessages,
      {
        agentId: 'message-paging-agent-public',
        content: 'Visible older message',
        createdAt: new Date('2026-08-20T00:00:00.000Z'),
        id: 'message-paging-visible-old',
        role: 'assistant',
        userId,
        workspaceId,
      },
      {
        agentId: 'message-paging-agent-public',
        content: 'Visible recent message',
        createdAt: new Date('2026-08-25T00:00:00.000Z'),
        id: 'message-paging-visible-recent',
        role: 'assistant',
        userId,
        workspaceId,
      },
    ]);
    const firstPage = privateMessages.map(({ id }, index) => ({
      _id: id,
      _score: 20 - index,
      sort: [20 - index, id],
    }));
    const client: ElasticsearchFtsSearchClient = {
      search: vi
        .fn()
        .mockResolvedValueOnce({ hits: { hits: firstPage } })
        .mockResolvedValueOnce({
          hits: {
            hits: [
              { _id: 'message-paging-visible-old', _score: 10 },
              { _id: 'message-paging-visible-recent', _score: 9 },
            ],
          },
        }),
    };
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace });

    const response = await backend.search(request('messages', { limit: 2 }));

    expect(response.items).toEqual([
      expect.objectContaining({ id: 'message-paging-visible-recent' }),
      expect.objectContaining({ id: 'message-paging-visible-old' }),
    ]);
    expect(client.search).toHaveBeenCalledTimes(2);
    expect(client.search).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        body: expect.objectContaining({ search_after: firstPage.at(-1)?.sort }),
        pagination: 'bounded',
      }),
    );
  });

  it('returns partial conversation results instead of exceeding the candidate budget', async () => {
    await db.insert(topics).values({
      id: 'budget-visible-topic',
      title: 'Visible within budget',
      userId,
      workspaceId,
    });
    let requestCount = 0;
    const client: ElasticsearchFtsSearchClient = {
      search: vi.fn().mockImplementation(({ body }) => {
        requestCount += 1;
        if (requestCount > 5) throw new Error('conversation paging exceeded its candidate budget');
        const searchAfter = body.search_after as [number, string] | undefined;
        const page = searchAfter?.[0] ?? 0;
        return Promise.resolve({
          hits: {
            hits: Array.from({ length: 8 }, (_, index) => {
              const id =
                page === 0 && index === 0
                  ? 'budget-visible-topic'
                  : `hidden-candidate-${page}-${index}`;
              return { _id: id, _score: 20 - page, sort: [page + 1, id] };
            }),
          },
        });
      }),
    };
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace });

    const response = await backend.search(request('topics', { limit: 2 }));

    expect(response.items).toEqual([expect.objectContaining({ id: 'budget-visible-topic' })]);
    expect(response.candidates).toHaveLength(40);
    expect(client.search).toHaveBeenCalledTimes(5);
  });

  it('searches message summaries but excludes tool, foreign, deleted, and private-parent hits in PG', async () => {
    await db.insert(agents).values([
      {
        id: 'message-agent-public',
        title: 'Public message agent',
        userId: otherUserId,
        visibility: 'public',
        workspaceId,
      },
      {
        id: 'message-agent-private',
        title: 'Private message agent',
        userId: otherUserId,
        visibility: 'private',
        workspaceId,
      },
    ]);
    await db.insert(chatGroups).values({
      id: 'message-group',
      title: 'Message group',
      userId: otherUserId,
      workspaceId,
    });
    await db.insert(sessions).values({
      id: 'message-session',
      title: 'Message session',
      userId: otherUserId,
      workspaceId,
    });
    await db.insert(topics).values({
      agentId: 'message-agent-public',
      groupId: 'message-group',
      id: 'message-topic',
      sessionId: 'message-session',
      title: 'Message topic',
      userId,
      workspaceId,
    });
    await db.insert(topics).values({
      agentId: 'message-agent-private',
      id: 'message-private-topic',
      title: 'Private parent agent topic',
      userId,
      workspaceId,
    });
    await db.insert(messages).values([
      {
        agentId: 'message-agent-public',
        content: 'Older hydrated message',
        createdAt: new Date('2026-08-20T00:00:00.000Z'),
        groupId: 'message-group',
        id: 'message-old',
        role: 'assistant',
        sessionId: 'message-session',
        summary: 'Search phrase only appears in this summary',
        topicId: 'message-topic',
        userId,
        workspaceId,
      },
      {
        agentId: 'message-agent-public',
        content: 'Recent hydrated message',
        createdAt: new Date('2026-08-25T00:00:00.000Z'),
        groupId: 'message-group',
        id: 'message-recent',
        role: 'user',
        sessionId: 'message-session',
        topicId: 'message-topic',
        userId,
        workspaceId,
      },
      {
        content: 'Tool payload',
        id: 'message-tool',
        role: 'tool',
        userId,
        workspaceId,
      },
      {
        agentId: 'message-agent-private',
        content: 'Private parent payload',
        id: 'message-private-agent',
        role: 'assistant',
        userId,
        workspaceId,
      },
      {
        content: 'Private topic parent payload',
        id: 'message-private-topic-parent',
        role: 'assistant',
        topicId: 'message-private-topic',
        userId,
        workspaceId,
      },
      {
        content: 'Foreign workspace payload',
        id: 'message-foreign-workspace',
        role: 'user',
        userId: otherUserId,
        workspaceId: otherWorkspaceId,
      },
    ]);
    const client = createClient([
      { _id: 'message-old', _score: 12 },
      { _id: 'message-tool', _score: 11 },
      { _id: 'message-private-agent', _score: 10 },
      { _id: 'message-private-topic-parent', _score: 9.5 },
      { _id: 'message-foreign-workspace', _score: 9 },
      { _id: 'message-deleted', _score: 8 },
      { _id: 'message-recent', _score: 7 },
    ]);
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace });

    const response = await backend.search(request('messages', { limit: 2 }));

    expect(response.items).toEqual([
      expect.objectContaining({ id: 'message-recent' }),
      expect.objectContaining({ id: 'message-old' }),
    ]);
    expect(response.items[0]).toMatchObject({
      agentId: 'message-agent-public',
      groupId: 'message-group',
      topicId: 'message-topic',
    });
    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          query: {
            bool: expect.objectContaining({
              must: [
                {
                  multi_match: {
                    fields: ['content^2', 'summary'],
                    operator: 'and',
                    query: 'search phrase',
                    type: 'best_fields',
                  },
                },
              ],
              must_not: [{ term: { fts_search_sync_deleted: true } }, { term: { role: 'tool' } }],
            }),
          },
        }),
        entity: 'messages',
        index: 'lobehub-dev-messages',
        pagination: 'bounded',
      }),
    );
  });

  it('searches files by name and rechecks hidden sources and restricted KB memberships in PG', async () => {
    const longFileDescription = `Hydrated file description ${'x'.repeat(220)}`;
    await db.insert(knowledgeBases).values([
      {
        id: 'file-kb-open',
        name: 'Open file KB',
        userId,
        visibility: 'public',
        workspaceId,
      },
      {
        id: 'file-kb-restricted',
        name: 'Restricted file KB',
        userId: otherUserId,
        visibility: 'public',
        workspaceId,
      },
    ]);
    await db.insert(files).values([
      {
        fileType: 'text/plain',
        id: 'file-open',
        name: 'Search phrase notes',
        size: 10,
        url: 'file://file-open',
        userId,
        workspaceId,
      },
      {
        fileType: 'text/plain',
        id: 'file-restricted',
        name: 'Search phrase restricted',
        size: 20,
        url: 'file://file-restricted',
        userId,
        workspaceId,
      },
      {
        fileType: 'text/plain',
        id: 'file-hidden-source',
        name: 'Search phrase acceptance',
        size: 30,
        source: FileSource.Acceptance,
        url: 'file://file-hidden-source',
        userId,
        workspaceId,
      },
      {
        fileType: 'custom/document',
        id: 'file-page-shell',
        name: 'Search phrase page shell',
        size: 40,
        url: 'file://file-page-shell',
        userId,
        workspaceId,
      },
      {
        fileType: 'text/plain',
        id: 'file-private-other',
        name: 'Search phrase private',
        size: 50,
        url: 'file://file-private-other',
        userId: otherUserId,
        visibility: 'private',
        workspaceId,
      },
    ]);
    await db.insert(knowledgeBaseFiles).values([
      { fileId: 'file-open', knowledgeBaseId: 'file-kb-open', userId, workspaceId },
      {
        fileId: 'file-restricted',
        knowledgeBaseId: 'file-kb-restricted',
        userId,
        workspaceId,
      },
    ]);
    await db.insert(documents).values({
      content: longFileDescription,
      fileId: 'file-open',
      fileType: 'text/plain',
      filename: 'search-phrase-notes.txt',
      source: 'file://search-phrase-notes.txt',
      sourceType: 'file',
      title: 'Search phrase notes',
      totalCharCount: longFileDescription.length,
      totalLineCount: 1,
      userId,
      workspaceId,
    });
    const client = createClient([
      { _id: 'file-restricted', _score: 12 },
      { _id: 'file-hidden-source', _score: 11 },
      { _id: 'file-page-shell', _score: 10 },
      { _id: 'file-private-other', _score: 9 },
      { _id: 'file-deleted', _score: 8 },
      { _id: 'file-open', _score: 7 },
    ]);
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace });

    const response = await backend.search(
      request('files', {
        filters: { excludeKnowledgeBaseIds: ['file-kb-restricted'] },
      }),
    );

    expect(response.items).toEqual([
      expect.objectContaining({
        description: `${longFileDescription.slice(0, 200)}...`,
        id: 'file-open',
        knowledgeBaseId: 'file-kb-open',
        type: 'file',
      }),
    ]);
    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          query: {
            bool: expect.objectContaining({
              must: [
                {
                  multi_match: {
                    fields: ['name.raw^8', 'name^4', 'name.words^2'],
                    operator: 'and',
                    query: 'search phrase',
                    type: 'best_fields',
                  },
                },
              ],
              must_not: expect.arrayContaining([
                { term: { file_type: 'custom/document' } },
                { terms: { source: [FileSource.Acceptance] } },
                { terms: { knowledge_base_ids: ['file-kb-restricted'] } },
              ]),
            }),
          },
        }),
        entity: 'files',
        index: 'lobehub-dev-files',
        pagination: 'bounded',
      }),
    );
  });

  it('keeps folder fields separate from page content and rechecks restricted document links', async () => {
    await db.insert(knowledgeBases).values({
      id: 'documents-kb-restricted',
      name: 'Restricted documents KB',
      userId: otherUserId,
      visibility: 'public',
      workspaceId,
    });
    await db.insert(documents).values([
      {
        description: 'Search phrase folder description',
        fileType: DOCUMENT_FOLDER_TYPE,
        filename: 'open-folder',
        id: 'folder-open',
        source: 'internal://folder/open',
        sourceType: 'api',
        title: 'Open search folder',
        totalCharCount: 0,
        totalLineCount: 0,
        userId,
        workspaceId,
      },
      {
        description: 'Search phrase restricted folder',
        fileType: DOCUMENT_FOLDER_TYPE,
        filename: 'restricted-folder',
        id: 'folder-restricted',
        knowledgeBaseId: 'documents-kb-restricted',
        source: 'internal://folder/restricted',
        sourceType: 'api',
        title: 'Restricted folder',
        totalCharCount: 0,
        totalLineCount: 0,
        userId,
        workspaceId,
      },
      {
        content: 'Search phrase appears only in page content',
        fileType: 'custom/document',
        filename: 'content-page',
        id: 'folder-page-candidate',
        source: 'internal://document/content-page',
        sourceType: 'api',
        title: 'Unrelated page title',
        totalCharCount: 42,
        totalLineCount: 1,
        userId,
        workspaceId,
      },
    ]);
    const client = createClient([
      { _id: 'folder-restricted', _score: 10 },
      { _id: 'folder-page-candidate', _score: 9 },
      { _id: 'folder-open', _score: 8 },
    ]);
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace });

    const response = await backend.search(
      request('documents', {
        filters: {
          documentKind: 'folder',
          excludeKnowledgeBaseIds: ['documents-kb-restricted'],
        },
      }),
    );

    expect(response.items).toEqual([
      expect.objectContaining({ id: 'folder-open', type: 'folder' }),
    ]);
    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          query: {
            bool: expect.objectContaining({
              filter: expect.arrayContaining([{ term: { file_type: DOCUMENT_FOLDER_TYPE } }]),
              must: [
                {
                  multi_match: {
                    fields: ['title^4', 'slug^3', 'description^2'],
                    operator: 'and',
                    query: 'search phrase',
                    type: 'best_fields',
                  },
                },
              ],
              must_not: expect.arrayContaining([
                { terms: { knowledge_base_ids: ['documents-kb-restricted'] } },
              ]),
            }),
          },
        }),
        entity: 'documents',
        index: 'lobehub-dev-documents',
        pagination: 'bounded',
      }),
    );
  });

  it('rechecks direct and file-backed restricted memberships while hydrating pages', async () => {
    await db.insert(knowledgeBases).values([
      {
        id: 'page-kb-open',
        name: 'Open page KB',
        userId,
        visibility: 'public',
        workspaceId,
      },
      {
        id: 'page-kb-restricted',
        name: 'Restricted page KB',
        userId: otherUserId,
        visibility: 'public',
        workspaceId,
      },
    ]);
    await db.insert(files).values({
      fileType: 'application/pdf',
      id: 'page-restricted-file',
      name: 'restricted.pdf',
      size: 100,
      url: 'file://page-restricted-file',
      userId,
      workspaceId,
    });
    await db.insert(knowledgeBaseFiles).values({
      fileId: 'page-restricted-file',
      knowledgeBaseId: 'page-kb-restricted',
      userId,
      workspaceId,
    });
    await db.insert(documents).values([
      {
        content: 'Search phrase open page',
        fileType: 'custom/document',
        filename: 'open-page',
        id: 'page-open',
        knowledgeBaseId: 'page-kb-open',
        source: 'internal://document/open-page',
        sourceType: 'api',
        title: 'Open page',
        totalCharCount: 23,
        totalLineCount: 1,
        userId,
        workspaceId,
      },
      {
        content: 'Search phrase direct restricted page',
        fileType: 'custom/document',
        filename: 'direct-restricted-page',
        id: 'page-direct-restricted',
        knowledgeBaseId: 'page-kb-restricted',
        source: 'internal://document/direct-restricted',
        sourceType: 'api',
        title: 'Direct restricted page',
        totalCharCount: 36,
        totalLineCount: 1,
        userId,
        workspaceId,
      },
      {
        content: 'Search phrase file restricted page',
        fileId: 'page-restricted-file',
        fileType: 'custom/document',
        filename: 'file-restricted-page',
        id: 'page-file-restricted',
        source: 'file://page-restricted-file',
        sourceType: 'file',
        title: 'File restricted page',
        totalCharCount: 34,
        totalLineCount: 1,
        userId,
        workspaceId,
      },
    ]);
    const client = createClient([
      { _id: 'page-direct-restricted', _score: 12 },
      { _id: 'page-file-restricted', _score: 11 },
      { _id: 'page-open', _score: 10 },
    ]);
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace });

    const response = await backend.search(
      request('documents', {
        filters: {
          documentKind: 'page',
          excludeKnowledgeBaseIds: ['page-kb-restricted'],
        },
      }),
    );

    expect(response.items).toEqual([expect.objectContaining({ id: 'page-open', type: 'page' })]);
    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          query: {
            bool: expect.objectContaining({
              filter: expect.arrayContaining([{ term: { file_type: 'custom/document' } }]),
              must: [
                {
                  multi_match: {
                    fields: ['title^4', 'slug^3', 'content'],
                    operator: 'and',
                    query: 'search phrase',
                    type: 'best_fields',
                  },
                },
              ],
              must_not: expect.arrayContaining([
                { terms: { knowledge_base_ids: ['page-kb-restricted'] } },
              ]),
            }),
          },
        }),
      }),
    );
  });

  it('hydrates inline and file-backed KB documents without truncating candidates by document size', async () => {
    const largeContent = `search phrase ${'x'.repeat(1_000_000)}`;
    await db.insert(knowledgeBases).values([
      {
        id: 'document-kb-target',
        name: 'Target document KB',
        userId,
        visibility: 'public',
        workspaceId,
      },
      {
        id: 'document-kb-other',
        name: 'Other document KB',
        userId,
        visibility: 'public',
        workspaceId,
      },
    ]);
    await db.insert(files).values({
      fileType: 'application/pdf',
      id: 'document-file-backed',
      name: 'file-backed.pdf',
      size: 1024,
      url: 'file://document-file-backed',
      userId,
      workspaceId,
    });
    await db.insert(knowledgeBaseFiles).values({
      fileId: 'document-file-backed',
      knowledgeBaseId: 'document-kb-target',
      userId,
      workspaceId,
    });
    await db.insert(documents).values([
      {
        content: largeContent,
        fileType: 'custom/document',
        filename: 'inline-large',
        id: 'document-inline-large',
        knowledgeBaseId: 'document-kb-target',
        source: 'internal://document/inline-large',
        sourceType: 'api',
        title: 'Large inline document',
        totalCharCount: largeContent.length,
        totalLineCount: 1,
        userId,
        visibility: 'private',
        workspaceId,
      },
      {
        content: 'Search phrase in parsed PDF',
        fileId: 'document-file-backed',
        fileType: 'application/pdf',
        filename: 'file-backed.pdf',
        id: 'document-file-backed-row',
        source: 'file://document-file-backed',
        sourceType: 'file',
        title: 'File-backed document',
        totalCharCount: 27,
        totalLineCount: 1,
        userId,
        workspaceId,
      },
      {
        content: 'Search phrase in another KB',
        fileType: 'custom/document',
        filename: 'other-kb',
        id: 'document-other-kb',
        knowledgeBaseId: 'document-kb-other',
        source: 'internal://document/other-kb',
        sourceType: 'api',
        title: 'Other KB document',
        totalCharCount: 27,
        totalLineCount: 1,
        userId,
        workspaceId,
      },
      {
        content: 'Search phrase folder',
        fileType: DOCUMENT_FOLDER_TYPE,
        filename: 'document-folder',
        id: 'document-folder',
        knowledgeBaseId: 'document-kb-target',
        source: 'internal://folder/document-folder',
        sourceType: 'api',
        title: 'Document folder',
        totalCharCount: 20,
        totalLineCount: 1,
        userId,
        workspaceId,
      },
    ]);
    const client = createClient([
      { _id: 'document-other-kb', _score: 13 },
      { _id: 'document-folder', _score: 12 },
      { _id: 'document-inline-large', _score: 11 },
      { _id: 'document-file-backed-row', _score: 10 },
      { _id: 'document-deleted', _score: 9 },
    ]);
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace });

    const response = await backend.search(
      request('documents', {
        filters: {
          documentKind: 'knowledgeBaseDocument',
          knowledgeBaseIds: ['document-kb-target'],
        },
      }),
    );

    expect(response.items).toEqual([
      expect.objectContaining({
        documentId: 'document-inline-large',
        knowledgeBaseId: 'document-kb-target',
      }),
      expect.objectContaining({
        documentId: 'document-file-backed-row',
        fileId: 'document-file-backed',
        knowledgeBaseId: 'document-kb-target',
      }),
    ]);
    expect(response.items[0]).toMatchObject({
      snippet: `${largeContent.slice(0, 300)}...`,
    });

    const publicAgentResponse = await backend.search(
      request('documents', {
        filters: {
          documentKind: 'knowledgeBaseDocument',
          knowledgeBaseIds: ['document-kb-target'],
        },
        scope: { callerAgentVisibility: 'public' },
      }),
    );
    expect(publicAgentResponse.items).toEqual([
      expect.objectContaining({ documentId: 'document-file-backed-row' }),
    ]);
    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          query: {
            bool: expect.objectContaining({
              filter: expect.arrayContaining([
                { terms: { knowledge_base_ids: ['document-kb-target'] } },
              ]),
              must_not: expect.arrayContaining([{ term: { file_type: DOCUMENT_FOLDER_TYPE } }]),
            }),
          },
        }),
      }),
    );
  });

  it('searches knowledge bases and rechecks visibility and restricted IDs in PG', async () => {
    await db.insert(knowledgeBases).values([
      {
        id: 'kb-public',
        name: 'Public search phrase KB',
        userId: otherUserId,
        visibility: 'public',
        workspaceId,
      },
      {
        id: 'kb-private-own',
        name: 'Own private search phrase KB',
        userId,
        visibility: 'private',
        workspaceId,
      },
      {
        id: 'kb-private-other',
        name: 'Other private search phrase KB',
        userId: otherUserId,
        visibility: 'private',
        workspaceId,
      },
      {
        id: 'kb-restricted',
        name: 'Restricted search phrase KB',
        userId: otherUserId,
        visibility: 'public',
        workspaceId,
      },
    ]);
    const client = createClient([
      { _id: 'kb-private-other', _score: 12 },
      { _id: 'kb-restricted', _score: 11 },
      { _id: 'kb-public', _score: 10 },
      { _id: 'kb-private-own', _score: 9 },
    ]);
    const backend = new ElasticsearchFtsSearchBackend(db, { client, indexNamespace });

    const response = await backend.search(
      request('knowledgeBases', {
        filters: { excludeKnowledgeBaseIds: ['kb-restricted'] },
      }),
    );

    expect(response.items).toEqual([
      expect.objectContaining({ id: 'kb-public', type: 'knowledgeBase' }),
      expect.objectContaining({ id: 'kb-private-own', type: 'knowledgeBase' }),
    ]);
    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          query: {
            bool: expect.objectContaining({
              must_not: expect.arrayContaining([{ terms: { id: ['kb-restricted'] } }]),
            }),
          },
        }),
        entity: 'knowledgeBases',
        index: 'lobehub-dev-knowledge-bases',
        pagination: 'bounded',
      }),
    );
  });

  it('rejects memory-layer entities in hydrated product-result mode', async () => {
    const backend = new ElasticsearchFtsSearchBackend(db, {
      client: createClient([{ _id: 'context-1', _score: 1 }]),
      indexNamespace,
    });

    await expect(backend.search(request('memoryContexts'))).rejects.toThrow(
      'Memory-layer entity only supports candidate search: memoryContexts',
    );
  });
});
