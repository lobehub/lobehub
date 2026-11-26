// @vitest-environment node
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getApiKeys } = vi.hoisted(() => ({ getApiKeys: vi.fn() }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => ({}) }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async () => true;
  },
}));
vi.mock('../services/api-key.service', () => ({
  ApiKeyService: class {
    getApiKeys = getApiKeys;
  },
}));

const { default: ApiKeysRoutes } = await import('./api-keys.route');
const { ApiKeySchema } = await import('../types/api-key.type');
const { paginatedListSchema } = await import('../helpers/pagination');

const apiKey = (i: number) => ({
  createdAt: new Date(2026, 0, i + 1).toISOString(),
  enabled: true,
  expiresAt: null,
  id: `key_${i}`,
  lastUsedAt: null,
  name: `Key ${i}`,
  scopes: null,
  updatedAt: new Date(2026, 0, i + 1).toISOString(),
});

const request = (path: string, { userId = 'user-1' }: { userId?: string | null } = {}) => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (userId) c.set('userId' as never, userId as never);
    await next();
  });
  app.route('/', ApiKeysRoutes);
  app.onError((error, c) =>
    c.json({ error: error.message }, error instanceof HTTPException ? error.status : 500),
  );
  return app.request(path);
};

const data = async (res: Response) => ((await res.json()) as { data: any }).data;

beforeEach(() => {
  getApiKeys.mockReset();
  getApiKeys.mockResolvedValue([0, 1, 2, 3, 4].map(apiKey));
});

describe('GET /api-keys', () => {
  it('requires authentication', async () => {
    expect((await request('/', { userId: null })).status).toBe(401);
    expect(getApiKeys).not.toHaveBeenCalled();
  });

  it('answers the paginated list object by default', async () => {
    const res = await request('/');
    expect(res.status).toBe(200);
    const page = await data(res);
    expect(() => paginatedListSchema(ApiKeySchema, { total: true }).parse(page)).not.toThrow();
    expect(page).toMatchObject({ hasMore: false, nextCursor: null, total: 5 });
    expect(page.items).toHaveLength(5);
  });

  it('pages through the keys with limit + cursor', async () => {
    const first = await data(await request('/?limit=2'));
    expect(first.items.map((k: { id: string }) => k.id)).toEqual(['key_0', 'key_1']);
    expect(first).toMatchObject({ hasMore: true, total: 5 });

    const second = await data(await request(`/?limit=2&cursor=${first.nextCursor}`));
    expect(second.items.map((k: { id: string }) => k.id)).toEqual(['key_2', 'key_3']);

    const last = await data(await request(`/?limit=2&cursor=${second.nextCursor}`));
    expect(last.items.map((k: { id: string }) => k.id)).toEqual(['key_4']);
    expect(last).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('rejects an invalid cursor with validation_error', async () => {
    const res = await request('/?cursor=bogus');
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'validation_error' });
  });

  it('keeps the legacy bare array behind format=array', async () => {
    const legacy = await data(await request('/?format=array'));
    expect(Array.isArray(legacy)).toBe(true);
    expect(() => ApiKeySchema.array().parse(legacy)).not.toThrow();
    expect(legacy).toHaveLength(5);
  });

  it('rejects an unknown format value', async () => {
    const res = await request('/?format=csv');
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'validation_error' });
  });
});
