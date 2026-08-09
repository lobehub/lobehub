import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetOpenRouterManagementClientForTests,
  createOpenRouterManagementClient,
} from './management';

vi.mock('@/envs/aico', () => ({
  aicoEnv: {
    AICO_CONTROL_PLANE_SERVICE_TOKEN: undefined,
    AICO_CONTROL_PLANE_URL: undefined,
    AICO_IS_CONTROL_PLANE: false,
    AICO_OPENROUTER_MOCK: false,
    AICO_TOMAN_PER_USD: 50_000,
    OPENROUTER_MANAGEMENT_API_KEY: undefined,
  },
}));

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
