// @vitest-environment node
import { eq, ilike, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import {
  agents,
  messagePlugins,
  messages,
  topics,
  topicShares,
  users,
  workspaceMembers,
  workspaces,
} from '@/database/schemas';

import {
  ExportedTopicSchema,
  TopicBatchResultSchema,
  TopicBranchResultSchema,
  TopicImportResultSchema,
  TopicSchema,
  TopicSearchResultSchema,
  TopicShareSchema,
  TopicTranscriptSchema,
} from '../types/topic.type';

const db = await getTestDB();
/** `all`: workspace-wide rights; `owner`: own rows only; `none`: no permission. */
const rbac = vi.hoisted(() => ({ mode: 'all' as 'all' | 'none' | 'owner' }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => db }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async (permissions: string[]) =>
      rbac.mode === 'all' ||
      (rbac.mode === 'owner' && !permissions.every((code) => code.endsWith(':all')));
    hasPermission = async () => rbac.mode === 'all';
    // The search view filter reads the caller's workspace grants; topics here
    // back no workspace-shared agent, so no grant decides their visibility.
    getUserPermissions = async () => [];
  },
}));
// The full-text backend is pg_search in production; stand in with a substring match.
vi.mock('@/server/services/ftsSearch', () => ({
  createFtsSearchRepo: async () => ({
    ftsSearchCandidateEnabled: true,
    ftsSearchCandidates: async ({ entity, query }: { entity: string; query: { text: string } }) => {
      const rows =
        entity === 'topics'
          ? await db
              .select({ id: topics.id })
              .from(topics)
              .where(ilike(topics.title, `%${query.text}%`))
          : await db
              .select({ id: messages.id })
              .from(messages)
              .where(ilike(messages.content, `%${query.text}%`));
      return { candidates: rows, total: rows.length };
    },
  }),
}));
vi.mock('@/envs/app', async (importOriginal) => {
  const actual = await importOriginal<{ appEnv: Record<string, unknown> }>();
  return { ...actual, appEnv: { ...actual.appEnv, APP_URL: 'https://app.example.com' } };
});

const { default: TopicRoutes } = await import('./topics.route');

const USER = 'topic-branch-user';
const OTHER = 'topic-branch-other';
const AGENT = 'agt_branch';
const AGENT_2 = 'agt_branch_2';
const TOPIC = 'tpc_branch';
const OTHER_TOPIC = 'tpc_branch_other';
const WS = 'ws_branch';
const WS_TOPIC = 'tpc_branch_ws';

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
const post = (path: string, body: unknown, options: RequestOptions = {}) =>
  request(path, { ...options, body, method: 'POST' });

beforeEach(async () => {
  rbac.mode = 'all';
  await db.delete(users);
  await db.insert(users).values([{ id: USER }, { id: OTHER }]);
  await db.insert(workspaces).values({ id: WS, name: 'WS', primaryOwnerId: OTHER, slug: 'ws' });
  await db.insert(workspaceMembers).values([
    { role: 'owner', userId: OTHER, workspaceId: WS },
    { role: 'member', userId: USER, workspaceId: WS },
  ]);
  await db.insert(agents).values([
    { id: AGENT, title: 'Agent', userId: USER },
    { id: AGENT_2, title: 'Agent 2', userId: USER },
    { id: 'agt_branch_other', title: 'Theirs', userId: OTHER },
  ]);
  await db.insert(topics).values([
    { agentId: AGENT, id: TOPIC, status: 'unread', title: 'Pelican notes', userId: USER },
    { id: OTHER_TOPIC, title: 'Pelican secrets', userId: OTHER },
    { id: WS_TOPIC, title: 'Pelican team', userId: OTHER, workspaceId: WS },
  ]);
  await db.insert(messages).values([
    {
      content: 'tell me about pelicans',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      id: 'msg_b1',
      role: 'user',
      topicId: TOPIC,
      userId: USER,
    },
    {
      content: 'Searching',
      createdAt: new Date('2026-01-01T00:00:01Z'),
      id: 'msg_b2',
      parentId: 'msg_b1',
      reasoning: { content: 'think' },
      role: 'assistant',
      tools: [
        { apiName: 'query', arguments: '{}', id: 'call_b', identifier: 'search', type: 'default' },
      ],
      topicId: TOPIC,
      userId: USER,
    },
    {
      content: 'pelicans eat fish',
      createdAt: new Date('2026-01-01T00:00:02Z'),
      id: 'msg_b3',
      parentId: 'msg_b2',
      role: 'tool',
      topicId: TOPIC,
      userId: USER,
    },
    {
      content: 'and herons?',
      createdAt: new Date('2026-01-01T00:00:03Z'),
      id: 'msg_b4',
      parentId: 'msg_b3',
      role: 'user',
      topicId: TOPIC,
      userId: USER,
    },
    {
      content: 'secret',
      id: 'msg_other',
      role: 'user',
      topicId: OTHER_TOPIC,
      userId: OTHER,
    },
  ]);
  await db.insert(messagePlugins).values({
    apiName: 'query',
    arguments: '{}',
    id: 'msg_b3',
    identifier: 'search',
    state: { page: 1 },
    toolCallId: 'call_b',
    type: 'default',
    userId: USER,
  });
});

const topicMessages = (topicId: string) =>
  db.select().from(messages).where(eq(messages.topicId, topicId)).orderBy(messages.createdAt);

describe('POST /:id/clone, /:id/fork, /:id/branch', () => {
  it('clone copies every message into a new topic', async () => {
    const res = await post(`/${TOPIC}/clone`, { title: 'Copy' });
    expect(res.status).toBe(201);
    const topic = TopicSchema.parse(await data(res));
    expect(topic).toMatchObject({ messageCount: 4, title: 'Copy' });
    expect(topic.id).not.toBe(TOPIC);
  });

  it('fork copies up to the given message', async () => {
    const res = await post(`/${TOPIC}/fork`, { messageId: 'msg_b2' });
    expect(res.status).toBe(201);
    const topic = TopicSchema.parse(await data(res));
    expect(topic).toMatchObject({ messageCount: 2, title: 'Pelican notes' });
  });

  it('branch ends at the user message with the new content', async () => {
    const res = await post(`/${TOPIC}/branch`, { content: 'and storks?', messageId: 'msg_b4' });
    expect(res.status).toBe(201);
    const result = TopicBranchResultSchema.parse(await data(res));
    const copied = await topicMessages(result.topic.id);
    expect(copied.at(-1)).toMatchObject({ content: 'and storks?', id: result.messageId });
    // The source is untouched.
    expect((await topicMessages(TOPIC)).at(-1)?.content).toBe('and herons?');
  });

  it('404s a message outside the topic and a non-user branch point', async () => {
    expect((await post(`/${TOPIC}/fork`, { messageId: 'msg_other' })).status).toBe(404);
    expect((await post(`/${TOPIC}/branch`, { content: 'x', messageId: 'msg_b2' })).status).toBe(
      404,
    );
  });

  it("refuses another user's topic, another workspace's topic and bad bodies", async () => {
    expect((await post(`/${OTHER_TOPIC}/clone`, {})).status).toBe(404);
    expect((await post(`/${TOPIC}/clone`, {}, { workspaceId: WS })).status).toBe(404);
    rbac.mode = 'owner';
    expect((await post(`/${OTHER_TOPIC}/clone`, {})).status).toBe(403);
    rbac.mode = 'all';
    expect((await post(`/${TOPIC}/fork`, {})).status).toBe(400);
    expect((await post(`/${TOPIC}/branch`, { messageId: 'msg_b4' })).status).toBe(400);
    expect((await db.select().from(topics).where(eq(topics.userId, USER))).length).toBe(1);
  });

  it('requires authentication and chat:write', async () => {
    expect((await post(`/${TOPIC}/clone`, {}, { userId: null })).status).toBe(401);
    expect((await post(`/${TOPIC}/clone`, {}, { scopes: ['chat:read'] })).status).toBe(403);
    rbac.mode = 'none';
    expect((await post(`/${TOPIC}/clone`, {})).status).toBe(403);
  });
});

describe('GET /:id/transcript', () => {
  it('pages the rows with cursors', async () => {
    const first = TopicTranscriptSchema.parse(
      await data(await request(`/${TOPIC}/transcript?limit=3`)),
    );
    expect(first.format).toBe('json');
    if (first.format !== 'json') throw new Error('expected json');
    expect(first.items.map((item) => item.id)).toEqual(['msg_b1', 'msg_b2', 'msg_b3']);
    expect(first.items[2]).toMatchObject({ role: 'tool', toolCallId: 'call_b' });
    expect(first).toMatchObject({ hasMore: true, topic: { id: TOPIC }, total: 4 });

    const second = TopicTranscriptSchema.parse(
      await data(await request(`/${TOPIC}/transcript?limit=3&cursor=${first.nextCursor}`)),
    );
    if (second.format !== 'json') throw new Error('expected json');
    expect(second.items.map((item) => item.id)).toEqual(['msg_b4']);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('renders Markdown', async () => {
    const page = TopicTranscriptSchema.parse(
      await data(await request(`/${TOPIC}/transcript?format=markdown`)),
    );
    if (page.format !== 'markdown') throw new Error('expected markdown');
    expect(page.markdown).toContain('# Pelican notes');
    expect(page.markdown).toContain('## User · 2026-01-01T00:00:00.000Z');
    expect(page.markdown).toContain('- Called `search.query` (`call_b`)');
    expect(page.markdown).toContain('> Result of `call_b`');
  });

  it("404s another user's topic and validates the format", async () => {
    expect((await request(`/${OTHER_TOPIC}/transcript`)).status).toBe(404);
    expect((await request(`/${TOPIC}/transcript?format=html`)).status).toBe(400);
    expect((await request(`/${TOPIC}/transcript`, { userId: null })).status).toBe(401);
  });
});

describe('GET /:id/export and POST /import', () => {
  it('round-trips a topic losslessly', async () => {
    const exportRes = await request(`/${TOPIC}/export`);
    expect(exportRes.status).toBe(200);
    const exported = ExportedTopicSchema.parse(await data(exportRes));
    expect(exported).toMatchObject({ title: 'Pelican notes', version: '2.0' });
    expect(exported.messages).toHaveLength(4);
    expect(exported.messages[2]).toMatchObject({
      plugin: { apiName: 'query', identifier: 'search' },
      pluginState: { page: 1 },
      role: 'tool',
      tool_call_id: 'call_b',
    });

    const importRes = await post('/import', { agentId: AGENT_2, data: exported });
    expect(importRes.status).toBe(201);
    const imported = TopicImportResultSchema.parse(await data(importRes));
    expect(imported).toMatchObject({
      messageCount: 4,
      topic: { agentId: AGENT_2, title: 'Pelican notes' },
    });

    const rows = await topicMessages(imported.topic.id);
    expect(rows.map((row) => row.content)).toEqual(
      (await topicMessages(TOPIC)).map((r) => r.content),
    );
    // The reply tree survives with re-issued ids.
    expect(rows[1].parentId).toBe(rows[0].id);
    const [plugin] = await db
      .select()
      .from(messagePlugins)
      .where(eq(messagePlugins.id, rows[2].id));
    expect(plugin).toMatchObject({ state: { page: 1 }, toolCallId: 'call_b' });
  });

  it('round-trips the runtime roles a topic stores, such as a verify card', async () => {
    await db.insert(messages).values({
      content: 'Delivery check passed',
      createdAt: new Date('2026-01-01T00:00:04Z'),
      id: 'msg_b5',
      parentId: 'msg_b4',
      role: 'verify',
      topicId: TOPIC,
      userId: USER,
    });

    const exported = ExportedTopicSchema.parse(await data(await request(`/${TOPIC}/export`)));
    expect(exported.messages.at(-1)).toMatchObject({ role: 'verify' });

    const res = await post('/import', { agentId: AGENT_2, data: exported });
    expect(res.status).toBe(201);
    const imported = TopicImportResultSchema.parse(await data(res));
    const rows = await topicMessages(imported.topic.id);
    expect(rows.map((row) => row.role)).toEqual(['user', 'assistant', 'tool', 'user', 'verify']);
  });

  it('accepts a chat-UI export that carries a tool intervention', async () => {
    // Shape written by `src/features/ShareModal/ShareJSON/generateFullExport.ts`:
    // a tool message parked for human approval also persists `pluginIntervention`.
    const res = await post('/import', {
      agentId: AGENT_2,
      data: {
        exportedAt: '2026-01-01T00:00:00.000Z',
        messages: [
          {
            content: 'search for pelicans',
            createdAt: '2026-01-01T00:00:00.000Z',
            id: 'ui_m1',
            role: 'user',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            content: '',
            createdAt: '2026-01-01T00:00:01.000Z',
            id: 'ui_m2',
            parentId: 'ui_m1',
            plugin: { apiName: 'query', arguments: '{}', identifier: 'search', type: 'default' },
            pluginIntervention: {
              batchId: 'batch_ui',
              operationId: 'op_ui',
              status: 'approved',
            },
            role: 'tool',
            tool_call_id: 'ui_call',
            updatedAt: '2026-01-01T00:00:01.000Z',
          },
        ],
        title: 'UI export with an intervention',
        version: '2.0',
      },
    });
    expect(res.status).toBe(201);
    const imported = TopicImportResultSchema.parse(await data(res));
    const rows = await topicMessages(imported.topic.id);
    expect(rows.map((row) => row.role)).toEqual(['user', 'tool']);
  });

  it('still refuses genuinely unknown message fields', async () => {
    const res = await post('/import', {
      agentId: AGENT,
      data: {
        exportedAt: '2026-01-01T00:00:00.000Z',
        messages: [
          {
            content: 'hi',
            createdAt: '2026-01-01T00:00:00.000Z',
            id: 'ui_unknown',
            role: 'user',
            unexpectedField: true,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        version: '2.0',
      },
    });
    expect(res.status).toBe(400);
  });

  it('imports a plain message list as a chain', async () => {
    const res = await post('/import', {
      agentId: AGENT,
      data: [
        { content: 'hi', role: 'user' },
        { content: 'hello', role: 'assistant' },
      ],
    });
    expect(res.status).toBe(201);
    const imported = await data(res);
    const rows = await topicMessages(imported.topic.id);
    expect(rows[1].parentId).toBe(rows[0].id);
  });

  it("refuses another user's agent or topic and bad payloads", async () => {
    expect(
      (
        await post('/import', {
          agentId: 'agt_branch_other',
          data: [{ content: 'x', role: 'user' }],
        })
      ).status,
    ).toBe(404);
    expect((await request(`/${OTHER_TOPIC}/export`)).status).toBe(404);
    expect(
      (await post('/import', { agentId: AGENT, data: [{ content: 'x', role: 'system' }] })).status,
    ).toBe(400);
    expect((await post('/import', { agentId: AGENT, data: { version: '9' } })).status).toBe(400);
    expect((await post('/import', { data: [] })).status).toBe(400);
  });
});

describe('GET /search', () => {
  it("matches titles and message text within the caller's topics", async () => {
    const res = await request('/search?q=herons');
    expect(res.status).toBe(200);
    const result = TopicSearchResultSchema.parse(await data(res));
    expect(result.items.map((topic) => topic.id)).toEqual([TOPIC]);

    const byTitle = await data(await request('/search?q=Pelican'));
    expect(byTitle.items.map((topic: { id: string }) => topic.id)).toEqual([TOPIC]);
  });

  it('scopes to an agent and to the workspace', async () => {
    expect((await data(await request(`/search?q=Pelican&agentId=${AGENT_2}`))).items).toEqual([]);
    const ws = await data(await request('/search?q=Pelican', { workspaceId: WS }));
    expect(ws.items.map((topic: { id: string }) => topic.id)).toEqual([WS_TOPIC]);
  });

  it('validates the query', async () => {
    expect((await request('/search')).status).toBe(400);
    expect((await request('/search?q=x', { userId: null })).status).toBe(401);
  });
});

describe('POST /batch', () => {
  it("trashes the caller's topics and skips others'", async () => {
    const res = await post('/batch', { action: 'delete', topicIds: [TOPIC, OTHER_TOPIC] });
    expect(res.status).toBe(200);
    expect(TopicBatchResultSchema.parse(await data(res))).toEqual({
      action: 'delete',
      count: 1,
      movedGoalIds: [],
    });
    const rows = await db
      .select({ deletedAt: topics.deletedAt, id: topics.id })
      .from(topics)
      .where(inArray(topics.id, [TOPIC, OTHER_TOPIC]));
    expect(rows.find((row) => row.id === TOPIC)?.deletedAt).not.toBeNull();
    expect(rows.find((row) => row.id === OTHER_TOPIC)?.deletedAt).toBeNull();
  });

  it('moves topics with their messages to another agent', async () => {
    const res = await post('/batch', { action: 'move', targetAgentId: AGENT_2, topicIds: [TOPIC] });
    expect(res.status).toBe(200);
    expect(await data(res)).toMatchObject({ action: 'move', count: 1 });
    const [topic] = await db.select().from(topics).where(eq(topics.id, TOPIC));
    expect(topic.agentId).toBe(AGENT_2);
  });

  it("refuses to move onto another user's agent", async () => {
    const res = await post('/batch', {
      action: 'move',
      targetAgentId: 'agt_branch_other',
      topicIds: [TOPIC],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const [topic] = await db.select().from(topics).where(eq(topics.id, TOPIC));
    expect(topic.agentId).toBe(AGENT);
  });

  it('lets a workspace member act only on topics they created', async () => {
    rbac.mode = 'owner';
    const res = await post(
      '/batch',
      { action: 'delete', topicIds: [WS_TOPIC] },
      { workspaceId: WS },
    );
    expect(res.status).toBe(403);
    const [topic] = await db.select().from(topics).where(eq(topics.id, WS_TOPIC));
    expect(topic.deletedAt).toBeNull();
  });

  it('validates the action', async () => {
    expect((await post('/batch', { action: 'archive', topicIds: [TOPIC] })).status).toBe(400);
    expect((await post('/batch', { action: 'move', topicIds: [TOPIC] })).status).toBe(400);
    expect((await post('/batch', { action: 'delete', topicIds: [] })).status).toBe(400);
  });
});

describe('POST /:id/share', () => {
  it('publishes a link, then revokes it', async () => {
    const res = await post(`/${TOPIC}/share`, { visibility: 'link' });
    expect(res.status).toBe(200);
    const share = TopicShareSchema.parse(await data(res));
    expect(share).toMatchObject({ topicId: TOPIC, visibility: 'link' });
    expect(share.url).toBe(`https://app.example.com/share/t/${share.shareId}`);

    const revoked = TopicShareSchema.parse(
      await data(await post(`/${TOPIC}/share`, { visibility: 'private' })),
    );
    expect(revoked).toEqual({ shareId: null, topicId: TOPIC, url: null, visibility: 'private' });
    expect(await db.select().from(topicShares).where(eq(topicShares.topicId, TOPIC))).toHaveLength(
      0,
    );
  });

  it("refuses another user's topic and bad visibility", async () => {
    expect((await post(`/${OTHER_TOPIC}/share`, { visibility: 'link' })).status).toBe(404);
    expect(
      await db.select().from(topicShares).where(eq(topicShares.topicId, OTHER_TOPIC)),
    ).toHaveLength(0);
    expect((await post(`/${TOPIC}/share`, { visibility: 'public' })).status).toBe(400);
  });
});

describe('POST /:id/read and PATCH /:id model pin', () => {
  it('clears the unread mark once', async () => {
    expect(await data(await post(`/${TOPIC}/read`, undefined))).toEqual({
      id: TOPIC,
      wasUnread: true,
    });
    expect(await data(await post(`/${TOPIC}/read`, undefined))).toEqual({
      id: TOPIC,
      wasUnread: false,
    });
    expect((await post(`/${OTHER_TOPIC}/read`, undefined)).status).toBe(404);
  });

  it('pins the model and provider together', async () => {
    const res = await request(`/${TOPIC}`, {
      body: { model: 'gpt-x', provider: 'openai' },
      method: 'PATCH',
    });
    expect(res.status).toBe(200);
    expect(TopicSchema.parse(await data(res))).toMatchObject({
      model: 'gpt-x',
      provider: 'openai',
    });
    expect((await request(`/${TOPIC}`, { body: { model: 'gpt-x' }, method: 'PATCH' })).status).toBe(
      400,
    );
  });
});

describe('server guard refusals keep their status', () => {
  const VISITOR_TOPIC = 'tpc_branch_visitor';

  beforeEach(async () => {
    // An agent-share visitor conversation: stored under the creator, sent by the visitor.
    await db.insert(topics).values({
      agentId: AGENT,
      id: VISITOR_TOPIC,
      senderId: OTHER,
      title: 'Visitor',
      userId: USER,
    });
  });

  it("404s copying, sharing or pinning a share visitor's topic instead of a 400", async () => {
    expect((await post(`/${VISITOR_TOPIC}/clone`, {})).status).toBe(404);
    expect((await post(`/${VISITOR_TOPIC}/read`, undefined)).status).toBe(404);
    expect((await post(`/${VISITOR_TOPIC}/share`, { visibility: 'link' })).status).toBe(404);
    expect(
      (
        await request(`/${VISITOR_TOPIC}`, {
          body: { model: 'gpt-x', provider: 'openai' },
          method: 'PATCH',
        })
      ).status,
    ).toBe(404);
    const [topic] = await db.select().from(topics).where(eq(topics.id, VISITOR_TOPIC));
    expect(topic.model).toBeNull();
    expect(
      await db.select().from(topicShares).where(eq(topicShares.topicId, VISITOR_TOPIC)),
    ).toHaveLength(0);
  });
});

describe('GET /search pages with cursors', () => {
  it('walks the ranked matches', async () => {
    await db
      .insert(topics)
      .values(
        [1, 2].map((i) => ({ id: `tpc_branch_more_${i}`, title: `Pelican ${i}`, userId: USER })),
      );
    const first = TopicSearchResultSchema.parse(
      await data(await request('/search?q=Pelican&limit=2')),
    );
    expect(first.items).toHaveLength(2);
    expect(first).toMatchObject({ hasMore: true, total: 3 });

    const second = TopicSearchResultSchema.parse(
      await data(await request(`/search?q=Pelican&limit=2&cursor=${first.nextCursor}`)),
    );
    expect(second.items).toHaveLength(1);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    expect(new Set([...first.items, ...second.items].map((topic) => topic.id)).size).toBe(3);
  });
});
