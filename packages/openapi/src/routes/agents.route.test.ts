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

    const [row] = await db.select().from(agents).where(eq(agents.id, agent.id));
    expect(row.metadata).toEqual({ personal: true });
  });

  it('defaults to not personal', async () => {
    const agent = await json(await request('/', { body: { title: 'Writer' }, method: 'POST' }));

    expect(agent.personal).toBe(false);
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
