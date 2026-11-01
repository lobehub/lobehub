// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '../../type';
import { FtsSearchRepo } from './index';
import type {
  FtsSearchBackend,
  FtsSearchBackendMeasurement,
  FtsSearchKnowledgeBaseDocumentHit,
  FtsSearchMessageResult,
} from './types';

const db = {} as LobeChatDatabase;
const now = new Date('2026-08-26T00:00:00.000Z');

const messageResult: FtsSearchMessageResult = {
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

describe('FtsSearchRepo backend boundary', () => {
  it('forwards the supported request contract without exposing the legacy ignored offset', async () => {
    const search = vi.fn<FtsSearchBackend['search']>().mockResolvedValue({
      candidates: [{ id: messageResult.id, score: 7.25 }],
      items: [messageResult],
    });
    const backend: FtsSearchBackend = { key: 'candidate', search };
    const repo = new FtsSearchRepo(db, 'user-1', 'workspace-1', 'public', { backend });

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
      pagination: { limit: 7 },
      query: { text: 'search text' },
      scope: {
        callerAgentVisibility: 'public',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
    });
  });

  it('emits provider-native candidates through the shared measurement hook', async () => {
    const measurements: FtsSearchBackendMeasurement[] = [];
    const backend: FtsSearchBackend = {
      key: 'candidate',
      search: vi.fn().mockResolvedValue({
        candidates: [
          { id: messageResult.id, score: 9.75 },
          { id: 'message-2', score: 8.5 },
        ],
        items: [messageResult],
      }),
    };
    const repo = new FtsSearchRepo(db, 'user-1', undefined, undefined, {
      backend,
      onMeasurement: (measurement) => {
        measurements.push(measurement);
      },
    });

    await repo.search({ agentId: 'agent-1', query: 'message', type: 'message' });

    expect(measurements).toHaveLength(1);
    expect(measurements[0]).toMatchObject({
      candidateCount: 2,
      itemCount: 1,
      provider: 'candidate',
      request: {
        entity: 'messages',
        filterKeys: ['agentId'],
        limit: 5,
        queryLength: 7,
        scope: 'personal',
      },
      status: 'success',
    });
    expect(measurements[0]).not.toHaveProperty('candidates');
    expect(measurements[0]?.request).not.toHaveProperty('query');
    expect(measurements[0]?.request).not.toHaveProperty('userId');
  });

  it('keeps measurement hook failures outside product behavior', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const backend: FtsSearchBackend = {
      key: 'candidate',
      search: vi.fn().mockResolvedValue({
        candidates: [{ id: messageResult.id, score: 9.75 }],
        items: [messageResult],
      }),
    };
    const repo = new FtsSearchRepo(db, 'user-1', undefined, undefined, {
      backend,
      onMeasurement: () => {
        throw new Error('measurement failed');
      },
    });

    await expect(repo.search({ query: 'message', type: 'message' })).resolves.toEqual([
      messageResult,
    ]);
    expect(consoleError).toHaveBeenCalledWith(
      '[FtsSearchRepo] measurement hook failed',
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it('keeps asynchronous measurement rejections outside product behavior', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const measurementError = new Error('async measurement failed');
    const backend: FtsSearchBackend = {
      key: 'candidate',
      search: vi.fn().mockResolvedValue({
        candidates: [{ id: messageResult.id, score: 9.75 }],
        items: [messageResult],
      }),
    };
    const repo = new FtsSearchRepo(db, 'user-1', undefined, undefined, {
      backend,
      onMeasurement: async () => {
        throw measurementError;
      },
    });

    await expect(repo.search({ query: 'message', type: 'message' })).resolves.toEqual([
      messageResult,
    ]);
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        '[FtsSearchRepo] measurement hook failed',
        measurementError,
      );
    });
    consoleError.mockRestore();
  });

  it('forwards KB scope and caller visibility through the same backend contract', async () => {
    const document: FtsSearchKnowledgeBaseDocumentHit = {
      documentId: 'document-1',
      knowledgeBaseId: 'kb-1',
      relevance: 1,
      snippet: 'Matched content',
      title: 'Matched document',
      updatedAt: now,
    };
    const search = vi.fn<FtsSearchBackend['search']>().mockResolvedValue({
      candidates: [{ id: document.documentId, score: 4.5 }],
      items: [document],
    });
    const repo = new FtsSearchRepo(db, 'user-1', 'workspace-1', 'public', {
      backend: { key: 'candidate', search },
    });

    await expect(repo.searchKnowledgeBaseDocuments('  knowledge  ', ['kb-1'], 12)).resolves.toEqual(
      [document],
    );
    expect(search).toHaveBeenCalledWith({
      entity: 'documents',
      filters: { documentKind: 'knowledgeBaseDocument', knowledgeBaseIds: ['kb-1'] },
      pagination: { limit: 12 },
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
    const measurements: FtsSearchBackendMeasurement[] = [];
    const search = vi.fn<FtsSearchBackend['search']>().mockRejectedValue(providerError);
    const repo = new FtsSearchRepo(db, 'user-1', undefined, undefined, {
      backend: { key: 'candidate', search },
      onMeasurement: (measurement) => {
        measurements.push(measurement);
      },
    });

    await expect(
      repo.search({ agentId: 'agent-1', query: 'message', type: 'message' }),
    ).rejects.toBe(providerError);
    expect(search).toHaveBeenCalledTimes(1);
    expect(measurements).toHaveLength(1);
    expect(measurements[0]).toMatchObject({
      errorType: 'Error',
      provider: 'candidate',
      request: {
        entity: 'messages',
        filterKeys: ['agentId'],
        limit: 5,
        queryLength: 7,
        scope: 'personal',
      },
      status: 'error',
    });
  });
});
