import type { LobeChatDatabase } from '@lobechat/database';
import { MergeStrategyEnum } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../types';

const mocks = vi.hoisted(() => ({
  createFtsSearchRepo: vi.fn(async () => ({ ftsSearchCandidateEnabled: false })),
  embeddings: vi.fn(),
  initModelRuntimeFromDB: vi.fn(),
  initModelRuntimeWithUserPayload: vi.fn(),
  normalizeUserMemorySearchQueries: vi.fn(function (queries?: string[]) {
    return queries ?? [];
  }),
  recordUserMemoryLexicalSearchDecision: vi.fn(),
  searchMemory: vi.fn(),
  shouldRunUserMemoryLexicalSearch: vi.fn(),
  updateIdentityEntry: vi.fn(),
}));

vi.mock('@/database/models/userMemory', () => ({
  normalizeUserMemorySearchQueries: mocks.normalizeUserMemorySearchQueries,
  shouldRunUserMemoryLexicalSearch: mocks.shouldRunUserMemoryLexicalSearch,
  UserMemoryModel: vi.fn().mockImplementation(function () {
    return {
      searchMemory: mocks.searchMemory,
      updateIdentityEntry: mocks.updateIdentityEntry,
    };
  }),
}));

vi.mock('@/database/schemas', () => ({
  userSettings: { id: 'id' },
}));

vi.mock('@/server/globalConfig', () => ({
  getServerDefaultFilesConfig: vi.fn(function () {
    return {
      embeddingModel: { model: 'default-embedding-model', provider: 'default-provider' },
    };
  }),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: mocks.initModelRuntimeFromDB,
  initModelRuntimeWithUserPayload: mocks.initModelRuntimeWithUserPayload,
}));

vi.mock('@/server/services/agentSignal/procedure', () => ({
  emitToolOutcomeSafely: vi.fn(),
  resolveToolOutcomeScope: vi.fn(function () {
    return { scope: 'user', scopeKey: 'user-1' };
  }),
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

  describe('context layer limits (default medium effort)', () => {
    const emptyResult = {
      activities: [],
      contexts: [],
      experiences: [],
      identities: [],
      preferences: [],
    };

    const runSearch = async (params: Record<string, unknown>) => {
      mocks.embeddings.mockResolvedValueOnce([[0.1, 0.2, 0.3]]);
      mocks.initModelRuntimeWithUserPayload.mockReturnValueOnce({ embeddings: mocks.embeddings });
      mocks.searchMemory.mockResolvedValueOnce(emptyResult);

      const runtime = await memoryRuntime.factory(createContext());
      await runtime.searchUserMemory({ queries: ['Project Atlas launch'], ...params });

      return mocks.searchMemory.mock.calls[0][0].topK;
    };

    it('searches context memories when the agent asks for the context layer', async () => {
      const topK = await runSearch({ layers: ['context'] });

      expect(topK.contexts).toBeGreaterThan(0);
    });

    it('honours an explicit topK.contexts within the explicit-request cap', async () => {
      const topK = await runSearch({ topK: { contexts: 10 } });

      expect(topK).toMatchObject({ contexts: 2, experiences: 0 });
    });

    it('keeps context memories out of searches that do not ask for them', async () => {
      const topK = await runSearch({ layers: ['preference'] });

      expect(topK).toMatchObject({ activities: 3, contexts: 0, experiences: 0, preferences: 3 });
    });
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

  // A tool call sends only the fields it changes; replace must not clear the rest.
  it('updates only the identity fields the tool call sent, keeping the rest on replace', async () => {
    mocks.embeddings.mockResolvedValueOnce([[0.1, 0.2, 0.3]]);
    mocks.initModelRuntimeWithUserPayload.mockReturnValueOnce({
      embeddings: mocks.embeddings,
    });
    mocks.updateIdentityEntry.mockResolvedValueOnce(true);

    const runtime = await memoryRuntime.factory(createContext());

    const result = await runtime.updateIdentityMemory({
      id: 'mem_1',
      mergeStrategy: MergeStrategyEnum.Replace,
      set: { title: null, withIdentity: { description: null, role: 'lead maintainer' } },
    });

    expect(result.success).toBe(true);
    expect(mocks.updateIdentityEntry).toHaveBeenCalledWith({
      base: undefined,
      identity: { role: 'lead maintainer' },
      identityId: 'mem_1',
      mergeStrategy: 'replace',
      preserveOmittedFields: true,
    });
  });
});
