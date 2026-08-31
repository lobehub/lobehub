import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../types';

const mocks = vi.hoisted(() => ({
  createFtsSearchRepo: vi.fn(async () => ({ ftsSearchCandidateEnabled: false })),
  embeddings: vi.fn(),
  initModelRuntimeFromDB: vi.fn(),
  initModelRuntimeWithUserPayload: vi.fn(),
  normalizeUserMemorySearchQueries: vi.fn((queries?: string[]) => queries ?? []),
  recordUserMemoryLexicalSearchDecision: vi.fn(),
  searchMemory: vi.fn(),
  shouldRunUserMemoryLexicalSearch: vi.fn(),
}));

vi.mock('@/database/models/userMemory', () => ({
  normalizeUserMemorySearchQueries: mocks.normalizeUserMemorySearchQueries,
  shouldRunUserMemoryLexicalSearch: mocks.shouldRunUserMemoryLexicalSearch,
  UserMemoryModel: vi.fn().mockImplementation(() => ({
    searchMemory: mocks.searchMemory,
  })),
}));

vi.mock('@/database/schemas', () => ({
  userSettings: { id: 'id' },
}));

vi.mock('@/server/globalConfig', () => ({
  getServerDefaultFilesConfig: vi.fn(() => ({
    embeddingModel: { model: 'default-embedding-model', provider: 'default-provider' },
  })),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: mocks.initModelRuntimeFromDB,
  initModelRuntimeWithUserPayload: mocks.initModelRuntimeWithUserPayload,
}));

vi.mock('@/server/services/agentSignal/procedure', () => ({
  emitToolOutcomeSafely: vi.fn(),
  resolveToolOutcomeScope: vi.fn(() => ({ scope: 'user', scopeKey: 'user-1' })),
}));

vi.mock('@/server/services/agentSignal/store/adapters/redis/policyStateStore', () => ({
  redisPolicyStateStore: {},
}));

vi.mock('@/server/services/ftsSearch', () => ({
  createFtsSearchRepo: mocks.createFtsSearchRepo,
}));

vi.mock('@/server/services/ftsSearch/observability', () => ({
  recordUserMemoryLexicalSearchDecision: mocks.recordUserMemoryLexicalSearchDecision,
}));

const { memoryRuntime } = await import('../memory');

const createContext = (): ToolExecutionContext => ({
  memoryEmbeddingRuntime: {
    model: 'server-embedding-model',
    payload: {
      apiKey: 'server-key',
      baseURL: 'https://embedding.example.com/v1',
    },
    provider: 'server-provider',
  },
  serverDB: {
    query: {
      userSettings: {
        findFirst: vi.fn(async () => undefined),
      },
    },
  } as unknown as LobeChatDatabase,
  toolManifestMap: {},
  userId: 'synthetic-user',
});

describe('memoryRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses server-owned embedding runtime for memory search', async () => {
    mocks.embeddings.mockResolvedValueOnce([[0.1, 0.2, 0.3]]);
    mocks.initModelRuntimeWithUserPayload.mockReturnValueOnce({
      embeddings: mocks.embeddings,
    });
    mocks.searchMemory.mockResolvedValueOnce({
      activities: [],
      contexts: [],
      experiences: [],
      identities: [],
      preferences: [],
    });

    const runtime = await memoryRuntime.factory(createContext());

    await runtime.searchUserMemory({ queries: ['renewal timeline'] });

    expect(mocks.initModelRuntimeWithUserPayload).toHaveBeenCalledWith(
      'server-provider',
      {
        apiKey: 'server-key',
        baseURL: 'https://embedding.example.com/v1',
      },
      { userId: 'synthetic-user' },
    );
    expect(mocks.initModelRuntimeFromDB).not.toHaveBeenCalled();
    expect(mocks.embeddings).toHaveBeenCalledWith(
      expect.objectContaining({
        input: ['renewal timeline'],
        model: 'server-embedding-model',
      }),
      expect.objectContaining({ user: 'synthetic-user' }),
    );
    expect(mocks.searchMemory).toHaveBeenCalledWith(
      expect.objectContaining({ queries: ['renewal timeline'] }),
      [[0.1, 0.2, 0.3]],
    );
  });

  it('records the lexical decision on the default Gateway memory path', async () => {
    const longQuery = 'context '.repeat(40).trimEnd();
    const embedding = [0.1, 0.2, 0.3];
    mocks.embeddings.mockResolvedValueOnce([embedding]);
    mocks.initModelRuntimeWithUserPayload.mockReturnValueOnce({ embeddings: mocks.embeddings });
    mocks.searchMemory.mockResolvedValueOnce({
      activities: [],
      contexts: [],
      experiences: [],
      identities: [],
      preferences: [],
    });
    mocks.shouldRunUserMemoryLexicalSearch.mockReturnValueOnce(false);

    const runtime = await memoryRuntime.factory(createContext());

    await runtime.searchUserMemory({ queries: [longQuery] });

    expect(mocks.shouldRunUserMemoryLexicalSearch).toHaveBeenCalledWith([longQuery], [embedding]);
    expect(mocks.recordUserMemoryLexicalSearchDecision).toHaveBeenCalledWith({
      decision: 'skipped_long_context',
      queryCharacters: Array.from(longQuery).length,
      source: 'tool',
    });
  });
});
