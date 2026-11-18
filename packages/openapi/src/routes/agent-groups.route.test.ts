// @vitest-environment node
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { sessionGroups, users } from '@/database/schemas';

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

const { default: AgentGroupRoutes } = await import('./agent-groups.route');
const { AgentGroupSchema, CreatedAgentGroupSchema } = await import('../types/agent-group.type');
const { DeletedResourceSchema } = await import('../types/common.type');

const USER = 'agent-group-user';

const request = (path: string, init: { body?: unknown; method?: string } = {}) => {
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.set('userId' as never, USER as never);
    await next();
  });
  app.route('/', AgentGroupRoutes);

  return app.request(path, {
    ...(init.body === undefined
      ? {}
      : { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } }),
    method: init.method ?? 'GET',
  });
};

const json = async (res: Response) => ((await res.json()) as { data: any }).data;

beforeEach(async () => {
  await db.delete(sessionGroups);
  await db.delete(users);
  await db.insert(users).values({ id: USER });
});

describe('agent groups', () => {
  it('creates, reads and lists a group in the documented shapes', async () => {
    const res = await request('/', { body: { name: 'Work', sort: 1 }, method: 'POST' });
    expect(res.status).toBe(201);
    const created = await json(res);
    expect(() => CreatedAgentGroupSchema.parse(created)).not.toThrow();

    const detail = await json(await request(`/${created.id}`));
    expect(detail).toMatchObject({ id: created.id, name: 'Work', sort: 1 });
    expect(() => AgentGroupSchema.parse(detail)).not.toThrow();

    const list = await json(await request('/'));
    expect(() => AgentGroupSchema.array().parse(list)).not.toThrow();
  });

  it('answers an update with the updated group', async () => {
    const { id } = await json(await request('/', { body: { name: 'Old' }, method: 'POST' }));

    const res = await request(`/${id}`, { body: { name: 'New' }, method: 'PATCH' });
    expect(res.status).toBe(200);
    const updated = await json(res);
    expect(updated).toMatchObject({ id, name: 'New' });
    expect(() => AgentGroupSchema.parse(updated)).not.toThrow();
  });

  it('answers a delete with the id that is now gone', async () => {
    const { id } = await json(await request('/', { body: { name: 'Doomed' }, method: 'POST' }));

    const res = await request(`/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const deleted = await json(res);
    expect(deleted).toEqual({ deleted: true, id });
    expect(() => DeletedResourceSchema.parse(deleted)).not.toThrow();
    expect(await db.select().from(sessionGroups).where(eq(sessionGroups.id, id))).toHaveLength(0);
  });
});
