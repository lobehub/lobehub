// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { aiModels, users } from '@/database/schemas';

import { ModelListSchema, ModelSchema } from '../types/model.type';

const db = await getTestDB();

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => db }));
// Every scope is granted unless a test narrows it; codes end in `:all` / `:owner`.
let grants: (code: string) => boolean = () => true;
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async (codes: string[]) => codes.some((code) => grants(code));
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
  grants = () => true;
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

/**
 * A model id is not an owner: `ai_models` is unique on (id, providerId, userId),
 * so every account that enables `gpt-4o` holds its own `gpt-4o` row. Resolving
 * ownership by id alone picked whichever row came first and, when that was
 * another account's, answered an owner-scoped caller with 403 — which is what
 * made `POST /api/v1/chat` fail for personal accounts on shared model ids.
 */
describe('model ownership with a model id other accounts also hold', () => {
  const OTHER = 'model-route-other-user';

  beforeEach(async () => {
    grants = (code) => code.endsWith(':owner');
    await db.insert(users).values({ id: OTHER });
    // The other account's row first, so an id-only lookup finds it.
    await db.insert(aiModels).values([
      { displayName: 'Theirs', id: 'shared-model', providerId: 'openai', userId: OTHER },
      { displayName: 'Mine', id: 'shared-model', providerId: 'openai', userId: USER },
    ]);
  });

  it('lets an owner-scoped caller read their own row', async () => {
    const res = await request('/openai/shared-model');

    expect(res.status).toBe(200);
    expect((await json(res)).displayName).toBe('Mine');
  });

  it('updates only the caller’s row', async () => {
    const res = await request('/openai/shared-model', {
      body: { displayName: 'Renamed' },
      method: 'PATCH',
    });

    expect(res.status).toBe(200);
    const rows = await db.query.aiModels.findMany({ columns: { displayName: true, userId: true } });
    expect(rows).toEqual(
      expect.arrayContaining([
        { displayName: 'Renamed', userId: USER },
        { displayName: 'Theirs', userId: OTHER },
      ]),
    );
  });

  it('still finds nothing when only another account holds the id', async () => {
    await db.delete(aiModels);
    await db.insert(aiModels).values({
      displayName: 'Theirs',
      id: 'their-model',
      providerId: 'openai',
      userId: OTHER,
    });

    expect((await request('/openai/their-model')).status).toBe(404);
  });
});
