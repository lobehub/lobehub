import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BUDGET_REQUEST_COOLDOWN_SECONDS,
  BUDGET_REQUEST_RETENTION_SECONDS,
  budgetRequest,
  isBudgetRequestCoolingDown,
} from './budgetRequest';

const state = vi.hoisted(() => ({
  available: true,
  failOn: undefined as string | undefined,
  hashes: new Map<string, Map<string, string>>(),
  scope: undefined as string | undefined,
  strings: new Map<string, string>(),
  ttls: new Map<string, number>(),
}));

const guard = (command: string) => {
  if (state.failOn === command) throw new Error(`${command} failed`);
};

const memoryClient = {
  del: vi.fn(async (key: string) => {
    guard('del');
    return state.strings.delete(key) ? 1 : 0;
  }),
  // Emulates the two Lua scripts of the domain: store (HSET + EXPIRE) and
  // compare-and-delete (HGET == version → HDEL, then cooldown DEL if it matches).
  eval: vi.fn(async (script: string, _numkeys: number, ...args: string[]) => {
    if (script.includes('EXPIRE')) {
      guard('eval');
      const [key, field, value] = args;
      const hash = state.hashes.get(key) ?? new Map<string, string>();
      state.hashes.set(key, hash);
      hash.set(field, value);
      state.ttls.set(key, Number(args[3]));
      if (state.failOn === 'evalAfterWrite') throw new Error('reply lost');
      return 1;
    }
    const [key, cooldownKey, field, version, releaseCooldown, cooldownVersion] = args;
    if (state.hashes.get(key)?.get(field) !== version) return 0;
    state.hashes.get(key)?.delete(field);
    if (releaseCooldown === '1' && state.strings.get(cooldownKey) === cooldownVersion)
      state.strings.delete(cooldownKey);
    return 1;
  }),
  hdel: vi.fn(async (key: string, ...fields: string[]) => {
    guard('hdel');
    return fields.filter((field) => state.hashes.get(key)?.delete(field)).length;
  }),
  hget: vi.fn(async (key: string, field: string) => {
    guard('hget');
    return state.hashes.get(key)?.get(field) ?? null;
  }),
  hgetall: vi.fn(async (key: string) => {
    guard('hgetall');
    return Object.fromEntries(state.hashes.get(key) ?? []);
  }),
  hset: vi.fn(async (key: string, field: string, value: string) => {
    guard('hset');
    const hash = state.hashes.get(key) ?? new Map<string, string>();
    state.hashes.set(key, hash);
    hash.set(field, value);
    return 1;
  }),
  set: vi.fn(async (key: string, value: string, options?: { nx?: boolean }) => {
    guard('set');
    if (options?.nx && state.strings.has(key)) return null;
    state.strings.set(key, value);
    return 'OK';
  }),
};

vi.mock('./client', () => ({
  getRedisServiceClient: async (scope: string) => {
    state.scope = scope;
    return state.available ? memoryClient : null;
  },
}));

const NOW = Date.UTC(2026, 10, 19, 8);
const HOUR = 60 * 60 * 1000;
const COOLDOWN_KEY = 'budget_request_cooldown:v1:ws-1:u-1';

describe('redisService.budgetRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.available = true;
    state.failOn = undefined;
    state.hashes.clear();
    state.strings.clear();
    state.ttls.clear();
  });

  it('stores the first request under the lobechat scope and dedupes repeats in the cooldown', async () => {
    const first = await budgetRequest.create(
      'ws-1',
      { note: 'demo', requestedAmount: 20, userId: 'u-1' },
      NOW,
    );
    const second = await budgetRequest.create('ws-1', { userId: 'u-1' }, NOW + HOUR);

    expect(state.scope).toBe('lobechat');
    expect(first).toEqual({
      created: true,
      persisted: true,
      request: { createdAt: NOW, note: 'demo', requestedAmount: 20, userId: 'u-1' },
    });
    expect(second).toEqual({ created: false, persisted: true, request: first.request });
    expect(memoryClient.set).toHaveBeenCalledWith(COOLDOWN_KEY, String(NOW), {
      ex: BUDGET_REQUEST_COOLDOWN_SECONDS,
      nx: true,
    });
    expect(state.ttls.get('budget_request:v1:ws-1')).toBe(BUDGET_REQUEST_RETENTION_SECONDS);
  });

  it('resolves concurrent calls to a single created request', async () => {
    const results = await Promise.all(
      [1, 2, 3].map(() => budgetRequest.create('ws-1', { userId: 'u-1' }, NOW)),
    );

    expect(results.filter((result) => result.created)).toHaveLength(1);
  });

  it('keeps members and workspaces apart', async () => {
    await budgetRequest.create('ws-1', { userId: 'u-1' }, NOW);

    expect((await budgetRequest.create('ws-1', { userId: 'u-2' }, NOW)).created).toBe(true);
    expect((await budgetRequest.create('ws-2', { userId: 'u-1' }, NOW)).created).toBe(true);
  });

  it('lists open requests newest first and drops expired ones', async () => {
    await budgetRequest.create(
      'ws-1',
      { userId: 'old' },
      NOW - BUDGET_REQUEST_RETENTION_SECONDS * 1000 - 1,
    );
    await budgetRequest.create('ws-1', { userId: 'u-1' }, NOW - 2 * HOUR);
    await budgetRequest.create('ws-1', { userId: 'u-2' }, NOW - HOUR);

    expect((await budgetRequest.list('ws-1', NOW)).map((request) => request.userId)).toEqual([
      'u-2',
      'u-1',
    ]);
    // The expired entry is pruned, not just hidden.
    expect(state.hashes.get('budget_request:v1:ws-1')?.has('old')).toBe(false);
  });

  it('keeps an older open request when a replacement cannot be stored', async () => {
    await budgetRequest.create('ws-1', { note: 'first', userId: 'u-1' }, NOW);
    // The cooldown ran out; the member asks again but the write fails.
    state.strings.delete(COOLDOWN_KEY);
    state.failOn = 'eval';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await budgetRequest.create(
      'ws-1',
      { note: 'second', userId: 'u-1' },
      NOW + 25 * HOUR,
    );
    state.failOn = undefined;

    expect(result.persisted).toBe(false);
    expect((await budgetRequest.get('ws-1', 'u-1', NOW + 25 * HOUR))?.note).toBe('first');
    expect(state.strings.has(COOLDOWN_KEY)).toBe(false);
    warn.mockRestore();
  });

  it('releases the cooldown when the request cannot be stored', async () => {
    state.failOn = 'eval';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await budgetRequest.create('ws-1', { userId: 'u-1' }, NOW);

    expect(result).toMatchObject({ created: true, persisted: false });
    expect(state.strings.has(COOLDOWN_KEY)).toBe(false);
    state.failOn = undefined;
    expect((await budgetRequest.create('ws-1', { userId: 'u-1' }, NOW + 1)).persisted).toBe(true);
    warn.mockRestore();
  });

  it('undoes a write whose reply was lost before releasing the cooldown', async () => {
    state.failOn = 'evalAfterWrite';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await budgetRequest.create('ws-1', { userId: 'u-1' }, NOW);

    expect(result).toMatchObject({ created: true, persisted: false });
    expect(state.hashes.get('budget_request:v1:ws-1')?.has('u-1')).toBe(false);
    expect(state.strings.has(COOLDOWN_KEY)).toBe(false);
    warn.mockRestore();
  });

  it('remove leaves a request that replaced the one it read', async () => {
    await budgetRequest.create('ws-1', { userId: 'u-1' }, NOW);
    // The member's cooldown ran out and they asked again between the admin's
    // read and delete.
    memoryClient.hget.mockImplementationOnce(async (key: string, field: string) => {
      const read = state.hashes.get(key)?.get(field) ?? null;
      state.strings.delete(COOLDOWN_KEY);
      await budgetRequest.create('ws-1', { note: 'again', userId: 'u-1' }, NOW + 2);
      return read;
    });

    expect(await budgetRequest.remove('ws-1', 'u-1', { now: NOW + 3 })).toBeNull();
    expect((await budgetRequest.get('ws-1', 'u-1', NOW + 3))?.note).toBe('again');
    expect(state.strings.get(COOLDOWN_KEY)).toBe(String(NOW + 2));
  });

  it('remove closes the request and lifts the cooldown', async () => {
    await budgetRequest.create('ws-1', { userId: 'u-1' }, NOW);

    expect((await budgetRequest.remove('ws-1', 'u-1', { now: NOW }))?.createdAt).toBe(NOW);
    expect(await budgetRequest.get('ws-1', 'u-1', NOW)).toBeNull();
    expect((await budgetRequest.create('ws-1', { userId: 'u-1' }, NOW + 1)).created).toBe(true);
  });

  it('remove with keepCooldown closes the request but keeps the member waiting', async () => {
    await budgetRequest.create('ws-1', { userId: 'u-1' }, NOW);

    await budgetRequest.remove('ws-1', 'u-1', { keepCooldown: true, now: NOW });

    expect(await budgetRequest.get('ws-1', 'u-1', NOW)).toBeNull();
    expect(await budgetRequest.create('ws-1', { userId: 'u-1' }, NOW + 1)).toEqual({
      created: false,
      persisted: true,
      request: null,
    });
  });

  it('remove returns null when the member never asked', async () => {
    expect(await budgetRequest.remove('ws-1', 'u-1', { now: NOW })).toBeNull();
  });

  it('fails open without Redis', async () => {
    state.available = false;

    expect(await budgetRequest.create('ws-1', { userId: 'u-1' }, NOW)).toEqual({
      created: true,
      persisted: false,
      request: { createdAt: NOW, userId: 'u-1' },
    });
    expect(await budgetRequest.get('ws-1', 'u-1', NOW)).toBeNull();
    expect(await budgetRequest.list('ws-1', NOW)).toEqual([]);
  });

  it('fails open on read errors', async () => {
    state.failOn = 'hget';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await budgetRequest.get('ws-1', 'u-1', NOW)).toBeNull();
    warn.mockRestore();
  });
});

describe('isBudgetRequestCoolingDown', () => {
  it('is true inside the cooldown and false after it', () => {
    const request = { createdAt: NOW, userId: 'u-1' };

    expect(isBudgetRequestCoolingDown(request, NOW + HOUR)).toBe(true);
    expect(isBudgetRequestCoolingDown(request, NOW + BUDGET_REQUEST_COOLDOWN_SECONDS * 1000)).toBe(
      false,
    );
  });
});
