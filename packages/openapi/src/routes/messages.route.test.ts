// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { files, messages, messagesFiles, sessions, topics, users } from '@/database/schemas';

import { DeletedResourceSchema, DeletedResourcesSchema } from '../types/common.type';
import { MessageCountSchema, MessageListSchema, MessageSchema } from '../types/message.type';

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
vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFullFileUrl = async (key: string) => `https://files.example.com/${key}`;
  },
}));

const { default: MessageRoutes } = await import('./messages.route');

const USER = 'message-route-user';
const TOPIC = 'tpc_message_route';

const request = (path: string, init: { body?: unknown; method?: string } = {}) => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId' as never, USER as never);
    await next();
  });
  app.route('/', MessageRoutes);

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
  await db.insert(sessions).values({ id: 'ssn_message_route', slug: 'route', userId: USER });
  await db.insert(topics).values({ id: TOPIC, sessionId: 'ssn_message_route', userId: USER });
  await db.insert(files).values({
    fileType: 'image/png',
    id: 'file_message_route',
    name: 'a.png',
    size: 3,
    url: 'files/a.png',
    userId: USER,
  });
  await db.insert(messages).values([
    {
      content: 'hello',
      id: 'msg_route_1',
      role: 'user',
      sessionId: 'ssn_message_route',
      topicId: TOPIC,
      userId: USER,
    },
    { content: 'hi', id: 'msg_route_2', role: 'assistant', topicId: TOPIC, userId: USER },
  ]);
  await db
    .insert(messagesFiles)
    .values({ fileId: 'file_message_route', messageId: 'msg_route_1', userId: USER });
});

describe('message routes answer their documented payloads', () => {
  it('GET /:id embeds files, session and topic', async () => {
    const res = await request('/msg_route_1');
    expect(res.status).toBe(200);

    const message = await json(res);
    expect(() => MessageSchema.parse(message)).not.toThrow();
    expect(message.files.map((file: { url: string }) => file.url)).toEqual([
      'https://files.example.com/files/a.png',
    ]);
    expect(message.session.id).toBe('ssn_message_route');
    expect(message.topic.id).toBe(TOPIC);
  });

  it('GET / and GET /count', async () => {
    const list = await json(await request(`/?topicId=${TOPIC}`));
    expect(() => MessageListSchema.parse(list)).not.toThrow();
    expect(list.total).toBe(2);

    const count = await json(await request(`/count?topicId=${TOPIC}`));
    expect(MessageCountSchema.parse(count)).toEqual({ count: 2 });
  });

  it('POST / answers the stored message', async () => {
    const res = await request('/', {
      body: { content: 'new', role: 'user', topicId: TOPIC },
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const message = await json(res);
    expect(() => MessageSchema.parse(message)).not.toThrow();
  });

  it('DELETE /:id answers the deleted id', async () => {
    const res = await request('/msg_route_2', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(DeletedResourceSchema.parse(await json(res))).toEqual({
      deleted: true,
      id: 'msg_route_2',
    });
  });

  it('DELETE /:id answers 404 for a message it did not delete', async () => {
    const res = await request('/msg_missing', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('DELETE / counts only the messages it actually removed', async () => {
    const res = await request('/', {
      body: { messageIds: ['msg_route_1', 'msg_route_2', 'msg_missing'] },
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(DeletedResourcesSchema.parse(await json(res))).toEqual({ count: 2, deleted: true });
  });
});
