import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gitHubRefs } from './gitHubRefs';

const store = new Map<string, string>();
const redis = vi.hoisted(() => ({ client: null as any }));
vi.mock('./client', () => ({ getRedisServiceClient: async () => redis.client }));

const memoryClient = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string, options?: { nx?: boolean }) => {
    if (options?.nx && store.has(key)) return null;
    store.set(key, value);
    return 'OK';
  }),
};

const ref = { branch: 'main', owner: 'LobeHub', repo: 'Skills' };
const first = 'a'.repeat(40);
const next = 'b'.repeat(40);

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  redis.client = memoryClient;
});

describe('redisService.gitHubRefs', () => {
  it('resolves a ref once for every check that shares it', async () => {
    const resolve = vi.fn().mockResolvedValue(first);

    expect(await gitHubRefs.remember(ref, resolve)).toBe(first);
    await vi.waitFor(() => expect(store.size).toBe(1));
    expect(await gitHubRefs.remember({ ...ref, owner: 'lobehub', repo: 'skills' }, resolve)).toBe(
      first,
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(memoryClient.set).toHaveBeenCalledWith(
      'github_ref_commit:v1:lobehub/skills:main',
      JSON.stringify(first),
      { nx: true, px: 5 * 60 * 1000 },
    );
  });

  it('serves the commit an import just recorded instead of the remembered one', async () => {
    await gitHubRefs.record(ref, first);
    await gitHubRefs.record(ref, next);

    const resolve = vi.fn();
    expect(await gitHubRefs.remember(ref, resolve)).toBe(next);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('keeps the import ref when an earlier cache miss finishes later', async () => {
    const lookup = Promise.withResolvers<string>();
    const resolve = vi.fn(() => lookup.promise);
    const checking = gitHubRefs.remember(ref, resolve);
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce());

    await gitHubRefs.record(ref, next);
    lookup.resolve(first);

    expect(await checking).toBe(next);
    expect(await gitHubRefs.remember(ref, resolve)).toBe(next);
    expect(resolve).toHaveBeenCalledOnce();
  });

  it('does not remember a failed resolution', async () => {
    await expect(
      gitHubRefs.remember(ref, () => Promise.reject(new Error('rate limited'))),
    ).rejects.toThrow('rate limited');

    expect(await gitHubRefs.remember(ref, async () => first)).toBe(first);
  });

  it('resolves live without Redis', async () => {
    redis.client = null;
    const resolve = vi.fn().mockResolvedValue(first);

    await gitHubRefs.record(ref, next);
    expect(await gitHubRefs.remember(ref, resolve)).toBe(first);
    expect(await gitHubRefs.remember(ref, resolve)).toBe(first);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
