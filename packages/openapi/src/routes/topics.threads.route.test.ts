// @vitest-environment node
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { messages, threads, topics, users, workspaceMembers, workspaces } from '@/database/schemas';

import { DeletedResourceSchema } from '../types/common.type';
import { TopicThreadCreateResultSchema, TopicThreadSchema } from '../types/topic.type';

const db = await getTestDB();
/** `all`: workspace-wide rights; `owner`: own rows only; `none`: no permission. */
const rbac = vi.hoisted(() => ({ mode: 'all' as 'all' | 'none' | 'owner' }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => db }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async (permissions: string[]) =>
      rbac.mode === 'all' ||
      (rbac.mode === 'owner' && !permissions.every((code) => code.endsWith(':all')));
  },
}));

const { default: TopicRoutes } = await import('./topics.route');

const USER = 'thread-route-user';
const OTHER = 'thread-route-other';
const TOPIC = 'tpc_thread_route';
const TOPIC_2 = 'tpc_thread_route_2';
const OTHER_TOPIC = 'tpc_thread_route_other';
const WS = 'ws_thread_route';
const WS_TOPIC = 'tpc_thread_route_ws';

interface RequestOptions {
  body?: unknown;
  method?: string;
  scopes?: string[];
  userId?: string | null;
  workspaceId?: string;
}

const request = (path: string, { body, method = 'GET', ...auth }: RequestOptions = {}) => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const userId = auth.userId === undefined ? USER : auth.userId;
    if (userId) c.set('userId' as never, userId as never);
    if (auth.workspaceId) c.set('workspaceId' as never, auth.workspaceId as never);
    if (auth.scopes) {
      c.set('authType' as never, 'apikey' as never);
      c.set('apiKeyScopes' as never, auth.scopes as never);
    }
    await next();
  });
  app.route('/', TopicRoutes);
  app.onError((error, c) =>
    c.json({ error: error.message }, error instanceof HTTPException ? error.status : 500),
  );

  return app.request(path, {
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    method,
  });
};

const data = async (res: Response) => ((await res.json()) as { data: any }).data;

beforeEach(async () => {
  rbac.mode = 'all';
  await db.delete(users);
  await db.insert(users).values([{ id: USER }, { id: OTHER }]);
  await db.insert(workspaces).values({ id: WS, name: 'WS', primaryOwnerId: OTHER, slug: 'ws' });
  await db.insert(workspaceMembers).values([
    { role: 'owner', userId: OTHER, workspaceId: WS },
    { role: 'member', userId: USER, workspaceId: WS },
  ]);
  await db.insert(topics).values([
    { id: TOPIC, userId: USER },
    { id: TOPIC_2, userId: USER },
    { id: OTHER_TOPIC, userId: OTHER },
    { id: WS_TOPIC, userId: OTHER, workspaceId: WS },
  ]);
  await db.insert(messages).values([
    { content: 'source', id: 'msg_thread_src', role: 'assistant', topicId: TOPIC, userId: USER },
    { content: 'elsewhere', id: 'msg_thread_2', role: 'user', topicId: TOPIC_2, userId: USER },
  ]);
  await db.insert(threads).values([
    { id: 'thd_mine', title: 'Mine', topicId: TOPIC, type: 'standalone', userId: USER },
    { id: 'thd_other', topicId: OTHER_TOPIC, type: 'standalone', userId: OTHER },
    { id: 'thd_ws', topicId: WS_TOPIC, type: 'standalone', userId: OTHER, workspaceId: WS },
  ]);
});

describe('POST /:topicId/threads', () => {
  it('creates a thread with its first message', async () => {
    const res = await request(`/${TOPIC}/threads`, {
      body: {
        message: { content: '**Dig** into this' },
        sourceMessageId: 'msg_thread_src',
        type: 'continuation',
      },
      method: 'POST',
    });
    expect(res.status).toBe(201);
    const result = TopicThreadCreateResultSchema.parse(await data(res));
    expect(result.thread).toMatchObject({
      title: 'Dig into this',
      topicId: TOPIC,
      type: 'continuation',
    });

    const [message] = await db.select().from(messages).where(eq(messages.id, result.messageId!));
    expect(message).toMatchObject({
      content: '**Dig** into this',
      parentId: 'msg_thread_src',
      role: 'user',
      threadId: result.thread.id,
      topicId: TOPIC,
    });
  });

  it('creates a bare thread nested under another', async () => {
    const res = await request(`/${TOPIC}/threads`, {
      body: { parentThreadId: 'thd_mine', title: 'Child', type: 'standalone' },
      method: 'POST',
    });
    expect(res.status).toBe(201);
    expect(await data(res)).toMatchObject({
      messageId: null,
      thread: { parentThreadId: 'thd_mine', title: 'Child' },
    });
  });

  it('404s references outside the topic and topics outside the scope', async () => {
    const post = (topicId: string, body: unknown, options: RequestOptions = {}) =>
      request(`/${topicId}/threads`, { ...options, body, method: 'POST' });

    expect(
      (await post(TOPIC, { sourceMessageId: 'msg_thread_2', type: 'standalone' })).status,
    ).toBe(404);
    expect((await post(TOPIC, { parentThreadId: 'thd_other', type: 'standalone' })).status).toBe(
      404,
    );
    expect((await post(OTHER_TOPIC, { type: 'standalone' })).status).toBe(404);
    expect((await post(TOPIC, { type: 'standalone' }, { workspaceId: WS })).status).toBe(404);
    expect(await db.select().from(threads).where(eq(threads.topicId, OTHER_TOPIC))).toHaveLength(1);
  });

  it('validates the body and requires auth and chat:write', async () => {
    const post = (body: unknown, options: RequestOptions = {}) =>
      request(`/${TOPIC}/threads`, { ...options, body, method: 'POST' });

    expect((await post({ type: 'nope' })).status).toBe(400);
    expect((await post({ message: { content: '' }, type: 'standalone' })).status).toBe(400);
    expect((await post({ type: 'standalone' }, { userId: null })).status).toBe(401);
    expect((await post({ type: 'standalone' }, { scopes: ['chat:read'] })).status).toBe(403);
    rbac.mode = 'none';
    expect((await post({ type: 'standalone' })).status).toBe(403);
  });
});

describe('PATCH /:topicId/threads/:threadId', () => {
  it('renames a thread and changes its status', async () => {
    const res = await request(`/${TOPIC}/threads/thd_mine`, {
      body: { status: 'completed', title: 'Renamed' },
      method: 'PATCH',
    });
    expect(res.status).toBe(200);
    expect(TopicThreadSchema.parse(await data(res))).toMatchObject({
      id: 'thd_mine',
      status: 'completed',
      title: 'Renamed',
    });
  });

  it('404s a thread of another topic or user, and validates the body', async () => {
    const patch = (path: string, body: unknown) => request(path, { body, method: 'PATCH' });

    expect((await patch(`/${TOPIC_2}/threads/thd_mine`, { title: 'x' })).status).toBe(404);
    expect((await patch(`/${OTHER_TOPIC}/threads/thd_other`, { title: 'x' })).status).toBe(404);
    expect((await patch(`/${TOPIC}/threads/thd_mine`, {})).status).toBe(400);
    expect((await patch(`/${TOPIC}/threads/thd_mine`, { status: 'gone' })).status).toBe(400);
  });

  it('lets a workspace member change only threads they created', async () => {
    rbac.mode = 'owner';
    const res = await request(`/${WS_TOPIC}/threads/thd_ws`, {
      body: { title: 'Hijacked' },
      method: 'PATCH',
      workspaceId: WS,
    });
    expect(res.status).toBe(403);
    const [thread] = await db.select().from(threads).where(eq(threads.id, 'thd_ws'));
    expect(thread.title).toBeNull();
  });
});

describe('DELETE /:topicId/threads/:threadId', () => {
  it('deletes the thread, then 404s', async () => {
    const res = await request(`/${TOPIC}/threads/thd_mine`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(DeletedResourceSchema.parse(await data(res))).toEqual({ deleted: true, id: 'thd_mine' });
    expect((await request(`/${TOPIC}/threads/thd_mine`, { method: 'DELETE' })).status).toBe(404);
  });

  it('refuses threads outside the caller reach', async () => {
    expect((await request(`/${OTHER_TOPIC}/threads/thd_other`, { method: 'DELETE' })).status).toBe(
      404,
    );
    rbac.mode = 'owner';
    expect(
      (await request(`/${WS_TOPIC}/threads/thd_ws`, { method: 'DELETE', workspaceId: WS })).status,
    ).toBe(403);
    expect(await db.select().from(threads).where(eq(threads.id, 'thd_ws'))).toHaveLength(1);
    expect(
      (await request(`/${TOPIC}/threads/thd_mine`, { method: 'DELETE', userId: null })).status,
    ).toBe(401);
  });
});
