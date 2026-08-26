// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '../../type';
import { SearchRepo } from './index';
import type {
  KnowledgeBaseDocumentHit,
  MessageSearchResult,
  SearchBackend,
  SearchBackendMeasurement,
} from './types';

const db = {} as LobeChatDatabase;
const now = new Date('2026-08-26T00:00:00.000Z');

const messageResult: MessageSearchResult = {
  agentId: 'agent-1',
  content: 'provider-neutral result',
  createdAt: now,
  description: 'Agent',
  groupId: null,
  id: 'message-1',
  model: null,
  relevance: 1,
  role: 'user',
  title: 'provider-neutral result',
  topicId: 'topic-1',
  type: 'message',
  updatedAt: now,
};

describe('SearchRepo backend boundary', () => {
  it('forwards query, entity, scope, filters, and pagination without changing items', async () => {
    const search = vi.fn<SearchBackend['search']>().mockResolvedValue({
      candidates: [{ id: messageResult.id, score: 7.25 }],
      items: [messageResult],
    });
    const backend: SearchBackend = { key: 'candidate', search };
    const repo = new SearchRepo(db, 'user-1', 'workspace-1', 'public', { backend });

    await expect(
      repo.search({
        agentId: 'agent-1',
        limitPerType: 7,
        offset: 4,
        query: '  search text  ',
        type: 'message',
      }),
    ).resolves.toEqual([messageResult]);

    expect(search).toHaveBeenCalledWith({
      entity: 'messages',
      filters: { agentId: 'agent-1' },
      pagination: { limit: 7, offset: 4 },
      query: { text: 'search text' },
      scope: {
        callerAgentVisibility: 'public',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
    });
  });

  it('emits provider-native candidates through the shared measurement hook', async () => {
    const measurements: SearchBackendMeasurement[] = [];
    const backend: SearchBackend = {
      key: 'candidate',
      search: vi.fn().mockResolvedValue({
        candidates: [{ id: messageResult.id, score: 9.75 }],
        items: [messageResult],
      }),
    };
    const repo = new SearchRepo(db, 'user-1', undefined, undefined, {
      backend,
      onMeasurement: (measurement) => measurements.push(measurement),
    });

    await repo.search({ query: 'message', type: 'message' });

    expect(measurements).toHaveLength(1);
    expect(measurements[0]).toMatchObject({
      candidates: [{ id: messageResult.id, score: 9.75 }],
      provider: 'candidate',
      status: 'success',
    });
  });

  it('keeps measurement hook failures outside product behavior', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const backend: SearchBackend = {
      key: 'candidate',
      search: vi.fn().mockResolvedValue({
        candidates: [{ id: messageResult.id, score: 9.75 }],
        items: [messageResult],
      }),
    };
    const repo = new SearchRepo(db, 'user-1', undefined, undefined, {
      backend,
      onMeasurement: () => {
        throw new Error('measurement failed');
      },
    });

    await expect(repo.search({ query: 'message', type: 'message' })).resolves.toEqual([
      messageResult,
    ]);
    expect(consoleError).toHaveBeenCalledWith(
      '[SearchRepo] measurement hook failed',
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it('forwards KB scope and caller visibility through the same backend contract', async () => {
    const document: KnowledgeBaseDocumentHit = {
      documentId: 'document-1',
      knowledgeBaseId: 'kb-1',
      relevance: 1,
      snippet: 'Matched content',
      title: 'Matched document',
      updatedAt: now,
    };
    const search = vi.fn<SearchBackend['search']>().mockResolvedValue({
      candidates: [{ id: document.documentId, score: 4.5 }],
      items: [document],
    });
    const repo = new SearchRepo(db, 'user-1', 'workspace-1', 'public', {
      backend: { key: 'candidate', search },
    });

    await expect(repo.searchKnowledgeBaseDocuments('  knowledge  ', ['kb-1'], 12)).resolves.toEqual(
      [document],
    );
    expect(search).toHaveBeenCalledWith({
      entity: 'documents',
      filters: { documentKind: 'knowledgeBaseDocument', knowledgeBaseIds: ['kb-1'] },
      pagination: { limit: 12, offset: 0 },
      query: { text: 'knowledge' },
      scope: {
        callerAgentVisibility: 'public',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
    });
  });

  it('reports and rethrows the original provider error without fallback', async () => {
    const providerError = new Error('provider failed');
    const measurements: SearchBackendMeasurement[] = [];
    const search = vi.fn<SearchBackend['search']>().mockRejectedValue(providerError);
    const repo = new SearchRepo(db, 'user-1', undefined, undefined, {
      backend: { key: 'candidate', search },
      onMeasurement: (measurement) => measurements.push(measurement),
    });

    await expect(repo.search({ query: 'message', type: 'message' })).rejects.toBe(providerError);
    expect(search).toHaveBeenCalledTimes(1);
    expect(measurements).toHaveLength(1);
    expect(measurements[0]).toMatchObject({
      error: providerError,
      provider: 'candidate',
      status: 'error',
    });
  });
});
