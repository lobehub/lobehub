import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetOpenRouterManagementClientForTests,
  createOpenRouterManagementClient,
} from './management';

describe('MockOpenRouterManagementClient', () => {
  beforeEach(() => {
    __resetOpenRouterManagementClientForTests();
  });

  it('creates, updates, and deletes keys', async () => {
    const client = createOpenRouterManagementClient({ forceMock: true });

    const created = await client.createKey({ limitUsd: 10, name: 'test' });
    expect(created.key).toMatch(/^sk-or-v1-mock-/);
    expect(created.limit).toBe(10);
    expect(created.limitRemaining).toBe(10);

    const got = await client.getKey(created.hash);
    expect(got.hash).toBe(created.hash);

    const updated = await client.updateKey({ hash: created.hash, limitUsd: 25 });
    expect(updated.limit).toBe(25);

    await client.deleteKey(created.hash);
    await expect(client.getKey(created.hash)).rejects.toThrow(/not found/);
  });
});

describe('HttpOpenRouterManagementClient', () => {
  it('posts create payload to OpenRouter keys endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        data: {
          disabled: false,
          hash: 'abc123',
          key: 'sk-or-v1-real',
          limit: 5,
          limit_remaining: 5,
          name: 'cust',
          usage: 0,
        },
      }),
      ok: true,
      status: 200,
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenRouterManagementClient({
      managementKey: 'mgmt-test-key',
    });

    const created = await client.createKey({ limitUsd: 5, name: 'cust' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/keys',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(created.key).toBe('sk-or-v1-real');
    expect(created.hash).toBe('abc123');

    vi.unstubAllGlobals();
  });
});
