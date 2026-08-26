import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../types';

const mocks = vi.hoisted(() => ({
  embeddings: vi.fn(),
  initModelRuntimeFromDB: vi.fn(),
  initModelRuntimeWithUserPayload: vi.fn(),
  searchMemory: vi.fn(),
}));

vi.mock('@/database/models/userMemory', () => ({
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
  // Real implementation is a pure fail-closed mapper (no I/O) — mirror it so
  // tests can assert the resulting shape reaches `initModelRuntimeFromDB`.
  buildAgentShareModelRuntimeContext: (
    agentShare?: { agentId?: string | null; visitorUserId?: string | null } | null,
  ) => {
    if (!agentShare) return undefined;
    const { agentId, visitorUserId } = agentShare;
    if (!agentId || !visitorUserId) {
      throw new Error(
        "Share-visitor model runtime billing context is incomplete (missing agentId/visitorUserId); refusing to fall back to the creator's ordinary billing.",
      );
    }
    return { agentShare: { agentId, visitorUserId } };
  },
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

  // Agent share P1 follow-up: `searchMemory` is the one memory API a share
  // visitor can reach (`allowReadMemory` grant, see `shareGate.ts`), and its
  // query embedding falls through to the DB-backed `initModelRuntimeFromDB`
  // path (no per-request `memoryEmbeddingRuntime`) — the exact shape the
  // nested `analyzeMedia` bug had.
  describe('searchMemory share billing (agent share P1 — nested embedding inference)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    const createShareContext = (agentShare?: {
      agentId?: string | null;
      visitorUserId?: string | null;
    }): ToolExecutionContext => ({
      agentShare: agentShare as any,
      serverDB: {
        query: { userSettings: { findFirst: vi.fn(async () => undefined) } },
      } as unknown as LobeChatDatabase,
      toolManifestMap: {},
      userId: 'creator-1',
    });

    it('forwards the share billing context so the query embedding bills the agentShare budget', async () => {
      mocks.initModelRuntimeFromDB.mockResolvedValueOnce({ embeddings: mocks.embeddings });
      mocks.embeddings.mockResolvedValueOnce([[0.4, 0.5, 0.6]]);
      mocks.searchMemory.mockResolvedValueOnce({
        activities: [],
        contexts: [],
        experiences: [],
        identities: [],
        preferences: [],
      });

      const runtime = await memoryRuntime.factory(
        createShareContext({ agentId: 'agent-1', visitorUserId: 'visitor-1' }),
      );

      await runtime.searchUserMemory({ queries: ['renewal timeline'] });

      expect(mocks.initModelRuntimeFromDB).toHaveBeenCalledWith(
        expect.anything(),
        'creator-1',
        'default-provider',
        undefined,
        { agentShare: { agentId: 'agent-1', visitorUserId: 'visitor-1' } },
      );
    });

    it('refuses instead of falling back to ordinary billing when the share marker is malformed', async () => {
      const runtime = await memoryRuntime.factory(
        // Missing `visitorUserId` — a broken upstream wiring, not "no share".
        createShareContext({ agentId: 'agent-1' }),
      );

      // `MemoryExecutionRuntime` catches the throw and surfaces it as a
      // failed tool result rather than rejecting the promise — still fail
      // closed (refused before any model call / spend), just caught one
      // layer earlier than `BuiltinToolsExecutor.execute`'s own try/catch.
      const result = await runtime.searchUserMemory({ queries: ['renewal timeline'] });

      expect(result.success).toBe(false);
      expect(result.content).toMatch(/incomplete/);
      expect(mocks.initModelRuntimeFromDB).not.toHaveBeenCalled();
    });
  });
});
