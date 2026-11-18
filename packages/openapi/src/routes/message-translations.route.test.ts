// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { messages, users } from '@/database/schemas';

import { DeletedResourceSchema } from '../types/common.type';
import {
  MessageTranslationSchema,
  MessageTranslationWriteSchema,
} from '../types/message-translations.type';

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
vi.mock('../services/chat.service', () => ({
  ChatService: class {
    translate = async () => 'Bonjour';
  },
}));

const { default: Routes } = await import('./message-translations.route');

const USER = 'translation-route-user';

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

const MESSAGE = 'msg_translation_route';

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({ id: USER });
  await db.insert(messages).values({ content: 'Hello', id: MESSAGE, role: 'user', userId: USER });
});

describe('message translation routes answer their documented payloads', () => {
  it('answers null before a translation exists', async () => {
    const res = await request(`/${MESSAGE}`);
    expect(res.status).toBe(200);
    expect(MessageTranslationSchema.nullable().parse(await json(res))).toBeNull();
  });

  it('translates, edits, reads and deletes a translation', async () => {
    const translated = await json(
      await request(`/${MESSAGE}`, { body: { to: 'fr-FR' }, method: 'POST' }),
    );
    expect(MessageTranslationWriteSchema.parse(translated)).toEqual({
      content: 'Bonjour',
      id: MESSAGE,
      to: 'fr-FR',
      userId: USER,
    });

    const edited = await json(
      await request(`/${MESSAGE}`, { body: { from: 'en-US', to: 'de-DE' }, method: 'PATCH' }),
    );
    expect(() => MessageTranslationWriteSchema.parse(edited)).not.toThrow();

    const stored = await json(await request(`/${MESSAGE}`));
    expect(MessageTranslationSchema.parse(stored)).toMatchObject({ id: MESSAGE, to: 'de-DE' });

    const deleted = await request(`/${MESSAGE}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(DeletedResourceSchema.parse(await json(deleted))).toEqual({
      deleted: true,
      id: MESSAGE,
    });
    expect((await request(`/${MESSAGE}`, { method: 'DELETE' })).status).toBe(404);
  });
});
