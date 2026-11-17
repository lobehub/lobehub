// @vitest-environment node
import { eq, ilike } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import {
  files,
  messagePlugins,
  messages,
  messagesFiles,
  topics,
  users,
  workspaces,
} from '@/database/schemas';

import { MessageListSchema, MessageSchema } from '../types/message.type';

const db = await getTestDB();
const rbac = vi.hoisted(() => ({ allow: true }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => db }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async () => rbac.allow;
  },
}));
vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFullFileUrl = async (key: string) => `https://files.example.com/${key}`;
  },
}));
// The full-text backend is pg_search in production; stand in with a substring match.
vi.mock('@/server/services/ftsSearch', () => ({
  createFtsSearchRepo: async () => ({
    ftsSearchCandidateEnabled: true,
    ftsSearchCandidates: async ({ query }: { query: { text: string } }) => {
      const rows = await db
        .select({ id: messages.id })
        .from(messages)
        .where(ilike(messages.content, `%${query.text}%`));
      return { candidates: rows, total: rows.length };
    },
  }),
}));

const { default: MessageRoutes } = await import('./messages.route');
const { MessageSearchResultSchema, TopicMessageStatsSchema } =
  await import('../types/message.type');

const USER = 'msg-edit-user';
const OTHER = 'msg-edit-other';
const TOPIC = 'tpc_msg_edit';
const OTHER_TOPIC = 'tpc_msg_edit_other';
const WS = 'ws_msg_edit';

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
  app.route('/', MessageRoutes);
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
  rbac.allow = true;
  await db.delete(users);
  await db.insert(users).values([{ id: USER }, { id: OTHER }]);
  await db.insert(workspaces).values({ id: WS, name: 'WS', primaryOwnerId: USER, slug: 'ws' });
  await db.insert(topics).values([
    { id: TOPIC, title: 'Edit topic', userId: USER },
    { id: OTHER_TOPIC, title: 'Secret topic', userId: OTHER },
    { id: 'tpc_msg_edit_ws', title: 'WS topic', userId: USER, workspaceId: WS },
  ]);
  await db.insert(messages).values([
    {
      content: 'tell me about pelicans',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      id: 'msg_user',
      role: 'user',
      topicId: TOPIC,
      userId: USER,
    },
    {
      content: 'Looking it up',
      createdAt: new Date('2026-01-01T00:00:01Z'),
      id: 'msg_assistant',
      parentId: 'msg_user',
      role: 'assistant',
      tools: [
        {
          apiName: 'query',
          arguments: '{"q":"pelican"}',
          id: 'call_1',
          identifier: 'search',
          type: 'default',
        },
      ],
      topicId: TOPIC,
      userId: USER,
    },
    {
      content: 'pelicans are large water birds',
      createdAt: new Date('2026-01-01T00:00:02Z'),
      id: 'msg_tool',
      parentId: 'msg_assistant',
      role: 'tool',
      topicId: TOPIC,
      userId: USER,
    },
    {
      content: 'pelicans in a secret topic',
      createdAt: new Date('2026-01-01T00:00:03Z'),
      id: 'msg_other',
      role: 'user',
      topicId: OTHER_TOPIC,
      userId: OTHER,
    },
    {
      content: 'workspace pelicans',
      createdAt: new Date('2026-01-01T00:00:04Z'),
      id: 'msg_ws',
      role: 'user',
      topicId: 'tpc_msg_edit_ws',
      userId: USER,
      workspaceId: WS,
    },
  ]);
  await db.insert(messagePlugins).values({
    apiName: 'query',
    arguments: '{"q":"pelican"}',
    id: 'msg_tool',
    identifier: 'search',
    toolCallId: 'call_1',
    type: 'default',
    userId: USER,
  });
  await db
    .insert(files)
    .values([
      { fileType: 'image/png', id: 'file_a', name: 'a.png', size: 3, url: 'a.png', userId: USER },
    ]);
});

describe('PATCH /:id', () => {
  it('edits the content and merges metadata, answering the whole message', async () => {
    const res = await request('/msg_user', {
      body: { content: 'tell me about herons', metadata: { tag: 'edited' } },
      method: 'PATCH',
    });
    expect(res.status).toBe(200);
    const message = MessageSchema.parse(await data(res));
    expect(message).toMatchObject({ content: 'tell me about herons', metadata: { tag: 'edited' } });
  });

  it('updates tool state, error and arguments on the tool call', async () => {
    const res = await request('/msg_tool', {
      body: {
        pluginError: { message: 'rate limited' },
        pluginState: { page: 2 },
        toolArguments: { arguments: { q: 'heron' }, toolCallId: 'call_1' },
      },
      method: 'PATCH',
    });
    expect(res.status).toBe(200);

    const [plugin] = await db
      .select()
      .from(messagePlugins)
      .where(eq(messagePlugins.id, 'msg_tool'));
    expect(plugin).toMatchObject({
      arguments: '{"q":"heron"}',
      error: { message: 'rate limited' },
      state: { page: 2 },
    });
    const [assistant] = await db.select().from(messages).where(eq(messages.id, 'msg_assistant'));
    expect((assistant.tools as any[])[0].arguments).toBe('{"q":"heron"}');
  });

  it('rejects tool fields on a non-tool message and a tool call it does not own', async () => {
    expect(
      (await request('/msg_user', { body: { pluginState: { a: 1 } }, method: 'PATCH' })).status,
    ).toBe(400);
    expect(
      (
        await request('/msg_user', {
          body: { toolArguments: { arguments: '{}', toolCallId: 'call_1' } },
          method: 'PATCH',
        })
      ).status,
    ).toBe(400);
  });

  it('validates the body', async () => {
    expect((await request('/msg_user', { body: {}, method: 'PATCH' })).status).toBe(400);
    expect((await request('/msg_user', { body: { content: 1 }, method: 'PATCH' })).status).toBe(
      400,
    );
    expect((await request('/msg_user', { body: { unknown: true }, method: 'PATCH' })).status).toBe(
      400,
    );
  });

  it("404s another user's message and one from another workspace, leaving them untouched", async () => {
    expect((await request('/msg_other', { body: { content: 'x' }, method: 'PATCH' })).status).toBe(
      404,
    );
    expect((await request('/msg_ws', { body: { content: 'x' }, method: 'PATCH' })).status).toBe(
      404,
    );
    expect(
      (
        await request('/msg_user', {
          body: { content: 'x' },
          method: 'PATCH',
          workspaceId: WS,
        })
      ).status,
    ).toBe(404);

    const rows = await db.select().from(messages).where(eq(messages.content, 'x'));
    expect(rows).toHaveLength(0);
  });

  it('requires authentication, the RBAC permission and the chat:write scope', async () => {
    const body = { content: 'x' };
    expect((await request('/msg_user', { body, method: 'PATCH', userId: null })).status).toBe(401);
    expect(
      (await request('/msg_user', { body, method: 'PATCH', scopes: ['chat:read'] })).status,
    ).toBe(403);
    rbac.allow = false;
    expect((await request('/msg_user', { body, method: 'PATCH' })).status).toBe(403);
  });
});

describe('POST /:id/files', () => {
  it('attaches files and answers the message with them', async () => {
    const res = await request('/msg_user/files', { body: { fileIds: ['file_a'] }, method: 'POST' });
    expect(res.status).toBe(200);
    const message = MessageSchema.parse(await data(res));
    expect(message.files.map((file) => file.id)).toEqual(['file_a']);
  });

  it("refuses another user's message, validation errors and missing auth", async () => {
    expect(
      (await request('/msg_other/files', { body: { fileIds: ['file_a'] }, method: 'POST' })).status,
    ).toBe(404);
    expect(
      await db.select().from(messagesFiles).where(eq(messagesFiles.messageId, 'msg_other')),
    ).toHaveLength(0);
    expect(
      (await request('/msg_user/files', { body: { fileIds: [] }, method: 'POST' })).status,
    ).toBe(400);
    expect(
      (
        await request('/msg_user/files', {
          body: { fileIds: ['file_a'] },
          method: 'POST',
          userId: null,
        })
      ).status,
    ).toBe(401);
  });
});

describe('GET /search', () => {
  it("searches the caller's messages only, with snippets and topic titles", async () => {
    const res = await request('/search?q=pelican');
    expect(res.status).toBe(200);
    const page = MessageSearchResultSchema.parse(await data(res));
    const ids = page.items.map((item) => item.id);
    expect(ids).toContain('msg_user');
    expect(ids).not.toContain('msg_other');
    expect(ids).not.toContain('msg_ws');
    expect(page.items.find((item) => item.id === 'msg_user')).toMatchObject({
      snippet: expect.stringContaining('pelican'),
      topicTitle: 'Edit topic',
    });
  });

  it('scopes to the workspace given by X-Workspace-Id', async () => {
    const page = await data(await request('/search?q=pelican', { workspaceId: WS }));
    expect(page.items.map((item: { id: string }) => item.id)).toEqual(['msg_ws']);
  });

  it('pages a find-in-topic with cursors', async () => {
    await db.insert(messages).values(
      [1, 2, 3].map((i) => ({
        content: `pelican fact ${i}`,
        createdAt: new Date(`2026-01-02T00:00:0${i}Z`),
        id: `msg_fact_${i}`,
        role: 'user' as const,
        topicId: TOPIC,
        userId: USER,
      })),
    );
    const first = MessageSearchResultSchema.parse(
      await data(await request(`/search?q=pelican&topicId=${TOPIC}&limit=2`)),
    );
    expect(first.items.map((item) => item.id)).toEqual(['msg_user', 'msg_fact_1']);
    expect(first.hasMore).toBe(true);

    const second = MessageSearchResultSchema.parse(
      await data(
        await request(`/search?q=pelican&topicId=${TOPIC}&limit=2&cursor=${first.nextCursor}`),
      ),
    );
    expect(second.items.map((item) => item.id)).toEqual(['msg_fact_2', 'msg_fact_3']);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("finds nothing in another user's topic and validates the query", async () => {
    const page = await data(await request(`/search?q=pelican&topicId=${OTHER_TOPIC}`));
    expect(page).toEqual({ hasMore: false, items: [], nextCursor: null });
    expect((await request('/search')).status).toBe(400);
    expect((await request('/search?q=a&limit=500')).status).toBe(400);
    expect((await request('/search?q=a', { userId: null })).status).toBe(401);
  });
});

describe('GET /stats', () => {
  it('answers the per-topic distribution of the caller', async () => {
    const res = await request('/stats');
    expect(res.status).toBe(200);
    const stats = TopicMessageStatsSchema.parse(await data(res));
    expect(stats).toMatchObject({ topics: 1, totalMessages: 3 });
  });

  it('filters by role and validates dates', async () => {
    const stats = await data(await request('/stats?role=user'));
    expect(stats).toMatchObject({ topics: 1, totalMessages: 1 });
    expect((await request('/stats?startDate=yesterday')).status).toBe(400);
  });
});

describe('GET / pages with cursors', () => {
  it('walks a topic with nextCursor', async () => {
    const first = MessageListSchema.parse(await data(await request(`/?topicId=${TOPIC}&limit=2`)));
    expect(first.messages.map((m) => m.id)).toEqual(['msg_user', 'msg_assistant']);
    expect(first).toMatchObject({ hasMore: true, total: 3 });

    const second = MessageListSchema.parse(
      await data(await request(`/?topicId=${TOPIC}&limit=2&cursor=${first.nextCursor}`)),
    );
    expect(second.messages.map((m) => m.id)).toEqual(['msg_tool']);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });

    expect((await request(`/?topicId=${TOPIC}&cursor=not-a-cursor`)).status).toBe(400);
  });
});

describe('PATCH /:id edge cases', () => {
  it('refuses a tool call id shared by two results before writing anything', async () => {
    await db.insert(messages).values({
      content: 'duplicate result',
      id: 'msg_tool_dup',
      parentId: 'msg_assistant',
      role: 'tool',
      topicId: TOPIC,
      userId: USER,
    });
    await db
      .insert(messagePlugins)
      .values({ id: 'msg_tool_dup', toolCallId: 'call_1', userId: USER });

    const res = await request('/msg_tool', {
      body: { content: 'changed', toolArguments: { arguments: '{}', toolCallId: 'call_1' } },
      method: 'PATCH',
    });
    expect(res.status).toBe(409);
    const [tool] = await db.select().from(messages).where(eq(messages.id, 'msg_tool'));
    expect(tool.content).toBe('pelicans are large water birds');
  });

  it("404s a share visitor's message instead of a 400", async () => {
    await db
      .insert(topics)
      .values({ id: 'tpc_msg_visitor', senderId: OTHER, title: 'Visitor', userId: USER });
    await db.insert(messages).values({
      content: 'hi',
      id: 'msg_visitor',
      role: 'user',
      topicId: 'tpc_msg_visitor',
      userId: USER,
    });

    expect(
      (await request('/msg_visitor', { body: { content: 'x' }, method: 'PATCH' })).status,
    ).toBe(404);
    const [message] = await db.select().from(messages).where(eq(messages.id, 'msg_visitor'));
    expect(message.content).toBe('hi');
  });
});

describe('PATCH /:id tool arguments on a detached result', () => {
  it('refuses before writing when the calling assistant no longer lists the call', async () => {
    await db.update(messages).set({ tools: [] }).where(eq(messages.id, 'msg_assistant'));

    const res = await request('/msg_tool', {
      body: { content: 'changed', toolArguments: { arguments: '{}', toolCallId: 'call_1' } },
      method: 'PATCH',
    });
    expect(res.status).toBe(400);
    const [tool] = await db.select().from(messages).where(eq(messages.id, 'msg_tool'));
    expect(tool.content).toBe('pelicans are large water birds');
  });
});
