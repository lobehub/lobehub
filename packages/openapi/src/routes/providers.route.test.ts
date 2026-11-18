// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { aiProviders, users } from '@/database/schemas';

import { DeletedResourceSchema } from '../types/common.type';
import { ProviderListSchema, ProviderSchema } from '../types/provider.type';

const db = await getTestDB();

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => db }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async () => true;
  },
}));
vi.mock('../middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => next(),
}));

const { default: Routes } = await import('./providers.route');

const USER = 'provider-route-user';

const request = (path: string, init: { body?: unknown; method?: string } = {}) => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId' as never, USER as never);
    await next();
  });
  app.route('/', Routes);

  return app.request(path, {
    ...(init.body === undefined
      ? {}
      : { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } }),
    method: init.method ?? 'GET',
  });
};

const json = async (res: Response) => ((await res.json()) as { data: any }).data;

beforeEach(async () => {
  await db.delete(aiProviders);
  await db.delete(users);
  await db.insert(users).values({ id: USER });
});

describe('provider routes answer their documented payloads', () => {
  it('creates, lists, reads, updates and deletes a provider', async () => {
    const created = await request('/', {
      body: { id: 'my-provider', name: 'Mine', settings: { sdkType: 'openai' } },
      method: 'POST',
    });
    expect(created.status).toBe(200);
    expect(ProviderSchema.parse(await json(created)).id).toBe('my-provider');

    const list = await json(await request('/'));
    expect(() => ProviderListSchema.parse(list)).not.toThrow();
    expect(list.total).toBe(1);

    const detail = await json(await request('/my-provider'));
    expect(ProviderSchema.parse(detail).source).toBe('custom');

    const updated = await json(
      await request('/my-provider', { body: { name: 'Renamed' }, method: 'PATCH' }),
    );
    expect(ProviderSchema.parse(updated).name).toBe('Renamed');

    const deleted = await request('/my-provider', { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(DeletedResourceSchema.parse(await json(deleted))).toEqual({
      deleted: true,
      id: 'my-provider',
    });
    expect((await request('/my-provider', { method: 'DELETE' })).status).toBe(404);
  });
});
