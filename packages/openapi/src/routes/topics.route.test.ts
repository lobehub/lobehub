// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { messages, threads, topics, users } from '@/database/schemas';

import { DeletedResourceSchema } from '../types/common.type';
import { TopicListSchema, TopicSchema, TopicThreadListSchema } from '../types/topic.type';

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

const { default: TopicRoutes } = await import('./topics.route');

const USER = 'topic-route-user';
const TOPIC = 'tpc_topic_route';

const request = (path: string, init: { body?: unknown; method?: string } = {}) => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId' as never, USER as never);
    await next();
  });
  app.route('/', TopicRoutes);

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
  await db.insert(users).values({ email: 'topic@example.com', id: USER });
  await db.insert(topics).values({
    id: TOPIC,
    metadata: { model: 'gpt-x' },
    status: 'active',
    title: 'Route topic',
    totalCost: 0.25,
    userId: USER,
  });
  await db
    .insert(messages)
    .values({ content: 'hi', id: 'msg_topic_route', role: 'user', topicId: TOPIC, userId: USER });
  await db
    .insert(threads)
    .values({ id: 'thd_topic_route', topicId: TOPIC, type: 'standalone', userId: USER });
});

describe('topic routes answer their documented payloads', () => {
  it('GET / and GET /:id carry the message count and the owner', async () => {
    const list = await json(await request('/'));
    expect(() => TopicListSchema.parse(list)).not.toThrow();
    expect(list.total).toBe(1);

    const res = await request(`/${TOPIC}`);
    expect(res.status).toBe(200);
    const topic = await json(res);
    expect(() => TopicSchema.parse(topic)).not.toThrow();
    expect(topic).toMatchObject({ messageCount: 1, totalCost: 0.25, user: { id: USER } });
  });

  it('POST / and PATCH /:id answer the whole topic', async () => {
    const created = await json(await request('/', { body: { title: 'New' }, method: 'POST' }));
    expect(() => TopicSchema.parse(created)).not.toThrow();

    const updated = await json(
      await request(`/${created.id}`, { body: { title: 'Renamed' }, method: 'PATCH' }),
    );
    expect(TopicSchema.parse(updated).title).toBe('Renamed');
  });

  it('GET /:topicId/threads', async () => {
    const page = await json(await request(`/${TOPIC}/threads`));
    expect(() => TopicThreadListSchema.parse(page)).not.toThrow();
    expect(page.total).toBe(1);
  });

  it('DELETE /:id answers the deleted id, then 404s', async () => {
    const res = await request(`/${TOPIC}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(DeletedResourceSchema.parse(await json(res))).toEqual({ deleted: true, id: TOPIC });

    expect((await request(`/${TOPIC}`, { method: 'DELETE' })).status).toBe(404);
  });
});
