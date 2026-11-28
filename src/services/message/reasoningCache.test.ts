import type { ModelReasoning } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { localDatabase } from '@/libs/localDatabase';
import { messageService } from '@/services/message';

import {
  getCachedReasoning,
  getCachedReasoningSync,
  loadMessageReasoning,
  resetReasoningCacheForTests,
  setCachedReasoning,
} from './reasoningCache';

const mocks = vi.hoisted(() => ({
  allowHydrate: true,
  allowPersist: true,
  currentScope: 'user_1:ws_1',
  storageMap: new Map<string, unknown>(),
}));

vi.mock('@/libs/localDatabase', () => ({
  localDatabase: {
    batch: vi.fn(async (ops: Array<{ key: string; type: string }>) => {
      for (const op of ops) {
        if (op.type === 'delete') mocks.storageMap.delete(op.key);
      }
    }),
    entriesByPrefix: vi.fn(async (_collection: string, prefix: string) =>
      [...mocks.storageMap.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value })),
    ),
    get: vi.fn(async (_collection: string, key: string) => mocks.storageMap.get(key)),
    set: vi.fn(async (_collection: string, key: string, value: unknown) => {
      mocks.storageMap.set(key, value);
    }),
  },
}));

vi.mock('@/libs/replica', () => ({
  cacheScope: {
    canHydrate: () => mocks.allowHydrate,
    canPersist: () => mocks.allowPersist,
    get: () => mocks.currentScope,
  },
}));

vi.mock('@/services/message', () => ({
  messageService: {
    getReasonings: vi.fn(),
  },
}));

describe('reasoningCache', () => {
  beforeEach(() => {
    mocks.storageMap.clear();
    resetReasoningCacheForTests();
    mocks.currentScope = 'user_1:ws_1';
    mocks.allowHydrate = true;
    mocks.allowPersist = true;
    vi.clearAllMocks();
  });

  it('fetches once, persists to localDatabase, and serves reloads with zero network calls', async () => {
    const full: ModelReasoning = { content: 'deep thought text', duration: 4200 };
    vi.mocked(messageService.getReasonings).mockResolvedValueOnce({ msg_1: full });

    const first = await loadMessageReasoning('msg_1');
    expect(first).toEqual(full);
    expect(messageService.getReasonings).toHaveBeenCalledTimes(1);
    expect(messageService.getReasonings).toHaveBeenCalledWith(['msg_1']);
    expect(getCachedReasoningSync('msg_1')).toEqual(full);

    // Simulate a full page reload (in-memory L1 cache cleared, IndexedDB L2 retained).
    resetReasoningCacheForTests();
    expect(getCachedReasoningSync('msg_1')).toBeUndefined();

    const afterReload = await loadMessageReasoning('msg_1');
    expect(afterReload).toEqual(full);
    expect(messageService.getReasonings).toHaveBeenCalledTimes(1);
    expect(localDatabase.get).toHaveBeenCalledTimes(2);
  });

  it('serves stream-prewarmed reasoning after reload without calling the server', async () => {
    await setCachedReasoning('msg_stream', { content: 'live thoughts', duration: 1500 });
    resetReasoningCacheForTests();

    const loaded = await loadMessageReasoning('msg_stream');
    expect(loaded).toEqual({ content: 'live thoughts', duration: 1500 });
    expect(messageService.getReasonings).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent requests for the same messageId', async () => {
    let resolveRpc: ((value: Record<string, ModelReasoning>) => void) | undefined;
    vi.mocked(messageService.getReasonings).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRpc = resolve;
        }),
    );

    const p1 = loadMessageReasoning('msg_dup');
    const p2 = loadMessageReasoning('msg_dup');

    await vi.waitFor(() => {
      expect(resolveRpc).toBeTypeOf('function');
    });

    resolveRpc!({ msg_dup: { content: 'shared', duration: 500 } });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toEqual({ content: 'shared', duration: 500 });
    expect(r2).toEqual({ content: 'shared', duration: 500 });
    expect(messageService.getReasonings).toHaveBeenCalledTimes(1);
  });

  it('isolates cached entries across user/workspace scopes', async () => {
    await setCachedReasoning('msg_shared_id', { content: 'user 1 secret', duration: 100 });

    mocks.currentScope = 'user_2:ws_2';
    expect(getCachedReasoningSync('msg_shared_id')).toBeUndefined();
    expect(await getCachedReasoning('msg_shared_id')).toBeUndefined();
  });

  it('skips persisting blank or signature-only reasoning', async () => {
    await setCachedReasoning('msg_sig', { signature: 'sig-only' });
    await setCachedReasoning('msg_blank', { content: '   ' });

    expect(localDatabase.set).not.toHaveBeenCalled();
  });

  it('does not persist under the new scope if scope switches while a fetch is in flight', async () => {
    let resolveRpc: ((value: Record<string, ModelReasoning>) => void) | undefined;
    vi.mocked(messageService.getReasonings).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRpc = resolve;
        }),
    );

    const pending = loadMessageReasoning('msg_race');
    await vi.waitFor(() => {
      expect(resolveRpc).toBeTypeOf('function');
    });

    mocks.currentScope = 'user_2:ws_2';
    resolveRpc!({ msg_race: { content: 'user 1 reasoning', duration: 300 } });
    await pending;

    expect(localDatabase.set).not.toHaveBeenCalled();
    expect(getCachedReasoningSync('msg_race')).toBeUndefined();
  });
});
