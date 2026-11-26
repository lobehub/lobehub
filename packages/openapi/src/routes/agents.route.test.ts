// @vitest-environment node
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { agents, users } from '@/database/schemas';

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

const { default: AgentRoutes } = await import('./agents.route');
const { AgentDetailSchema, AgentListSchema, AgentSchema } = await import('../types/agent.type');
const { DeletedResourceSchema } = await import('../types/common.type');

const USER = 'personal-agent-user';

const request = (path: string, init: { body?: unknown; method?: string } = {}) => {
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.set('userId' as never, USER as never);
    await next();
  });
  app.route('/', AgentRoutes);

  return app.request(path, {
    ...(init.body === undefined
      ? {}
      : { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } }),
    method: init.method ?? 'GET',
  });
};

const json = async (res: Response) => ((await res.json()) as { data: any }).data;

beforeEach(async () => {
  await db.delete(agents);
  await db.delete(users);
  await db.insert(users).values({ id: USER });
});

describe('personal agents', () => {
  it('creates a personal agent and reports the flag', async () => {
    const res = await request('/', { body: { personal: true, title: 'toby' }, method: 'POST' });

    expect(res.status).toBe(200);
    const agent = await json(res);
    expect(agent.personal).toBe(true);
    expect(() => AgentSchema.parse(agent)).not.toThrow();

    const [row] = await db.select().from(agents).where(eq(agents.id, agent.id));
    expect(row.metadata).toEqual({ personal: true });
  });

  it('defaults to not personal', async () => {
    const agent = await json(await request('/', { body: { title: 'Writer' }, method: 'POST' }));

    expect(agent.personal).toBe(false);
  });

  it('returns the starter tools on create and keeps an explicit opt-out on subsequent reads', async () => {
    const agent = await json(await request('/', { body: { title: 'Writer' }, method: 'POST' }));
    expect(agent.plugins.map((plugin: { identifier: string }) => plugin.identifier)).toEqual([
      'lobe-image-generation',
      'lobe-video-generation',
      'lobe-agent-documents',
      'lobe-agent',
    ]);

    const plugins = [{ identifier: 'lobe-image-generation', mode: 'disabled' }];
    const updated = await request(`/${agent.id}`, { body: { plugins }, method: 'PATCH' });
    expect(updated.status).toBe(200);
    expect((await json(await request(`/${agent.id}`))).plugins).toEqual(plugins);
  });

  it('filters the list by personal', async () => {
    await request('/', { body: { personal: true, title: 'toby' }, method: 'POST' });
    await request('/', { body: { title: 'Writer' }, method: 'POST' });

    const personal = await json(await request('/?personal=true'));
    const others = await json(await request('/?personal=false'));
    const all = await json(await request('/'));

    expect(personal.agents.map((agent: any) => agent.title)).toEqual(['toby']);
    expect(personal.total).toBe(1);
    expect(others.agents.map((agent: any) => agent.title)).toEqual(['Writer']);
    expect(all.total).toBe(2);
    expect(() => AgentListSchema.parse(all)).not.toThrow();
  });

  it('treats a non-boolean metadata.personal as not personal instead of failing', async () => {
    const agent = await json(await request('/', { body: { title: 'Legacy' }, method: 'POST' }));
    await db
      .update(agents)
      .set({ metadata: { personal: 'yes' } })
      .where(eq(agents.id, agent.id));

    const personal = await request('/?personal=true');
    const others = await request('/?personal=false');

    expect(personal.status).toBe(200);
    expect((await json(personal)).total).toBe(0);
    expect((await json(others)).agents.map((row: any) => row.title)).toEqual(['Legacy']);
  });

  it('keeps the personal flag on a duplicate', async () => {
    const agent = await json(
      await request('/', { body: { personal: true, title: 'toby' }, method: 'POST' }),
    );

    const res = await request(`/${agent.id}/duplicate`, { body: {}, method: 'POST' });
    expect(res.status).toBe(201);
    const copy = await json(res);

    expect(copy.id).not.toBe(agent.id);
    expect(copy.personal).toBe(true);
    expect(() => AgentDetailSchema.parse(copy)).not.toThrow();
    expect((await json(await request('/?personal=true'))).total).toBe(2);
  });

  it('rejects a personal filter that is not a boolean', async () => {
    const res = await request('/?personal=yes');

    expect(res.status).toBe(400);
  });

  it('toggles the flag on update without dropping other metadata', async () => {
    const agent = await json(await request('/', { body: { title: 'Writer' }, method: 'POST' }));
    await db
      .update(agents)
      .set({ metadata: { source: 'import' } })
      .where(eq(agents.id, agent.id));

    const on = await json(
      await request(`/${agent.id}`, { body: { personal: true }, method: 'PATCH' }),
    );
    expect(on.personal).toBe(true);

    const off = await json(
      await request(`/${agent.id}`, { body: { personal: false }, method: 'PATCH' }),
    );
    expect(off.personal).toBe(false);

    const [row] = await db.select().from(agents).where(eq(agents.id, agent.id));
    expect(row.metadata).toEqual({ personal: false, source: 'import' });
  });
});

describe('agent detail and deletion', () => {
  it('returns the agent with its mounted knowledge', async () => {
    const agent = await json(await request('/', { body: { title: 'Writer' }, method: 'POST' }));

    const res = await request(`/${agent.id}`);
    expect(res.status).toBe(200);
    const detail = await json(res);
    expect(detail).toMatchObject({ files: [], id: agent.id, knowledgeBases: [] });
    expect(() => AgentDetailSchema.parse(detail)).not.toThrow();
  });

  it('answers a delete with the id that is now gone', async () => {
    const agent = await json(await request('/', { body: { title: 'Doomed' }, method: 'POST' }));

    const res = await request(`/${agent.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const deleted = await json(res);
    expect(deleted).toEqual({ deleted: true, id: agent.id });
    expect(() => DeletedResourceSchema.parse(deleted)).not.toThrow();
    expect(await db.select().from(agents).where(eq(agents.id, agent.id))).toHaveLength(0);
  });
});

describe('agent list pagination', () => {
  const seed = async (count: number) => {
    for (let i = 0; i < count; i++) {
      await request('/', { body: { title: `Agent ${i}` }, method: 'POST' });
    }
  };
  const titles = (page: { agents: { title: string }[] }) => page.agents.map((agent) => agent.title);

  it('reports hasMore and a nextCursor that fetches the next offset', async () => {
    await seed(3);

    const first = await json(await request('/?limit=2'));
    expect(first).toMatchObject({ hasMore: true, total: 3 });
    expect(first.agents).toHaveLength(2);
    expect(() => AgentListSchema.parse(first)).not.toThrow();

    const second = await json(
      await request(`/?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`),
    );
    expect(second).toMatchObject({ hasMore: false, nextCursor: null, total: 3 });
    expect(second.agents).toHaveLength(1);
    expect(new Set([...titles(first), ...titles(second)]).size).toBe(3);
  });

  it('still honors the deprecated page/pageSize and matches the cursor pages', async () => {
    await seed(3);

    const byCursor = await json(await request('/?limit=2'));
    const next = await json(await request(`/?limit=2&cursor=${byCursor.nextCursor}`));
    const byPage = await json(await request('/?page=2&pageSize=2'));

    expect(titles(byPage)).toEqual(titles(next));
    expect(byPage).toMatchObject({ hasMore: false, nextCursor: null, total: 3 });
  });

  it('rejects a cursor it did not issue', async () => {
    const res = await request('/?cursor=garbage');
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'validation_error' });
  });
});
