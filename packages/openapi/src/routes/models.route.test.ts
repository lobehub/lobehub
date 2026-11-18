// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { aiModels, users } from '@/database/schemas';

import { ModelListSchema, ModelSchema } from '../types/model.type';

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

const { default: Routes } = await import('./models.route');

const USER = 'model-route-user';

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
  await db.delete(aiModels);
  await db.delete(users);
  await db.insert(users).values({ id: USER });
});

describe('model routes answer their documented payloads', () => {
  it('creates, lists, reads and updates a model', async () => {
    const created = await request('/', {
      body: {
        abilities: { vision: true },
        displayName: 'My Model',
        id: 'my-model',
        providerId: 'my-provider',
        type: 'stt',
      },
      method: 'POST',
    });
    expect(created.status).toBe(200);
    expect(ModelSchema.parse(await json(created)).type).toBe('asr');

    const list = await json(await request('/'));
    expect(() => ModelListSchema.parse(list)).not.toThrow();
    expect(list.total).toBe(1);

    const detail = await json(await request('/my-provider/my-model'));
    expect(() => ModelSchema.parse(detail)).not.toThrow();

    const updated = await json(
      await request('/my-provider/my-model', { body: { displayName: 'Renamed' }, method: 'PATCH' }),
    );
    expect(ModelSchema.parse(updated).displayName).toBe('Renamed');

    expect((await request('/my-provider/missing')).status).toBe(404);
  });
});
