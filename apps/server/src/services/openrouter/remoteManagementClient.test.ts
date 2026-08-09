import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aicoEnv } from '@/envs/aico';

import {
  __resetOpenRouterManagementClientForTests,
  createOpenRouterManagementClient,
  RemoteOpenRouterManagementClient,
} from './management';

vi.mock('@/envs/aico', () => ({
  aicoEnv: {
    AICO_CONTROL_PLANE_SERVICE_TOKEN: undefined as string | undefined,
    AICO_CONTROL_PLANE_URL: undefined as string | undefined,
    AICO_IS_CONTROL_PLANE: false,
    AICO_OPENROUTER_MOCK: false,
    AICO_TOMAN_PER_USD: 50_000,
    OPENROUTER_MANAGEMENT_API_KEY: undefined as string | undefined,
  },
}));

describe('RemoteOpenRouterManagementClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetOpenRouterManagementClientForTests();
  });

  it('maps create/get/update/delete through the control-plane proxy', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';

      if (method === 'POST' && url.endsWith('/internal/openrouter/v1/keys')) {
        return new Response(
          JSON.stringify({
            data: {
              disabled: false,
              hash: 'hash_abc',
              limit: 10,
              limit_remaining: 10,
              name: 'test',
              usage: 0,
            },
            key: 'sk-or-v1-created',
          }),
          { status: 200 },
        );
      }
      if (method === 'GET' && url.includes('/hash_abc')) {
        return new Response(
          JSON.stringify({
            data: {
              disabled: false,
              hash: 'hash_abc',
              limit: 10,
              limit_remaining: 9,
              name: 'test',
              usage: 1,
            },
          }),
          { status: 200 },
        );
      }
      if (method === 'PATCH' && url.includes('/hash_abc')) {
        return new Response(
          JSON.stringify({
            data: {
              disabled: true,
              hash: 'hash_abc',
              limit: 25,
              limit_remaining: 25,
              name: 'renamed',
              usage: 0,
            },
          }),
          { status: 200 },
        );
      }
      if (method === 'DELETE' && url.includes('/hash_abc')) {
        return new Response(null, { status: 204 });
      }
      return new Response('unexpected', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new RemoteOpenRouterManagementClient('http://cp.local', 'tok_secret');
    const created = await client.createKey({ limitUsd: 10, name: 'test' });
    expect(created.key).toBe('sk-or-v1-created');
    expect(created.hash).toBe('hash_abc');

    const got = await client.getKey('hash_abc');
    expect(got.usage).toBe(1);

    const updated = await client.updateKey({
      disabled: true,
      hash: 'hash_abc',
      limitUsd: 25,
      name: 'renamed',
    });
    expect(updated.limit).toBe(25);
    expect(updated.disabled).toBe(true);

    await client.deleteKey('hash_abc');

    const authCalls = fetchMock.mock.calls.map((c) => (c[1] as RequestInit)?.headers);
    expect(
      authCalls.every((h) => (h as Record<string, string>).Authorization === 'Bearer tok_secret'),
    ).toBe(true);
  });
});

describe('createOpenRouterManagementClient product / control-plane rules', () => {
  beforeEach(() => {
    __resetOpenRouterManagementClientForTests();
    aicoEnv.AICO_CONTROL_PLANE_SERVICE_TOKEN = undefined;
    aicoEnv.AICO_CONTROL_PLANE_URL = undefined;
    aicoEnv.AICO_IS_CONTROL_PLANE = false;
    aicoEnv.AICO_OPENROUTER_MOCK = false;
    aicoEnv.OPENROUTER_MANAGEMENT_API_KEY = undefined;
  });

  afterEach(() => {
    __resetOpenRouterManagementClientForTests();
    vi.unstubAllGlobals();
  });

  it('uses remote client when control plane URL + token are set', () => {
    aicoEnv.AICO_CONTROL_PLANE_URL = 'http://localhost:3020';
    aicoEnv.AICO_CONTROL_PLANE_SERVICE_TOKEN = 'tok';
    const client = createOpenRouterManagementClient({});
    expect(client).toBeInstanceOf(RemoteOpenRouterManagementClient);
  });

  it('production product server rejects embedded management key', () => {
    const prevNode = process.env.NODE_ENV;
    try {
      (process.env as { NODE_ENV?: string }).NODE_ENV = 'production';
      aicoEnv.OPENROUTER_MANAGEMENT_API_KEY = 'sk-or-v1-should-not-be-here';
      expect(() => createOpenRouterManagementClient({})).toThrow(
        /must not be set on the product server/,
      );
    } finally {
      (process.env as { NODE_ENV?: string }).NODE_ENV = prevNode;
    }
  });

  it('production product server requires control plane URL when no management key', () => {
    const prevNode = process.env.NODE_ENV;
    try {
      (process.env as { NODE_ENV?: string }).NODE_ENV = 'production';
      expect(() => createOpenRouterManagementClient({})).toThrow(/AICO_CONTROL_PLANE_URL/);
    } finally {
      (process.env as { NODE_ENV?: string }).NODE_ENV = prevNode;
    }
  });

  it('control plane may use local management key', () => {
    aicoEnv.AICO_IS_CONTROL_PLANE = true;
    aicoEnv.OPENROUTER_MANAGEMENT_API_KEY = 'sk-or-v1-control';
    const client = createOpenRouterManagementClient({});
    expect(client.constructor.name).toContain('Http');
  });
});
