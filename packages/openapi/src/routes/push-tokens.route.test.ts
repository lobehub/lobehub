// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { pushTokens, users } from '@/database/schemas';

import { DeletedResourceSchema } from '../types/common.type';
import { PushTokenRegistrationSchema } from '../types/im.type';

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

const { default: Routes } = await import('./push-tokens.route');

const USER = 'push-token-route-user';

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
  await db.delete(users);
  await db.insert(users).values({ id: USER });
});

describe('push token routes answer their documented payloads', () => {
  it('registers a device, then unregisters it with the device id', async () => {
    const registered = await request('/device-1', {
      body: { expoToken: 'ExponentPushToken[aaa]', platform: 'android' },
      method: 'PUT',
    });
    expect(registered.status).toBe(200);
    expect(PushTokenRegistrationSchema.parse(await json(registered))).toEqual({
      deviceId: 'device-1',
      platform: 'android',
    });

    const deleted = await request('/device-1', { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(DeletedResourceSchema.parse(await json(deleted))).toEqual({
      deleted: true,
      id: 'device-1',
    });
    expect(await db.select().from(pushTokens)).toEqual([]);
  });
});
