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
const { paginatedListSchema } = await import('../helpers/pagination');

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
    expect(() => paginatedListSchema(AgentGroupSchema, { total: true }).parse(list)).not.toThrow();
    expect(list).toMatchObject({ hasMore: false, nextCursor: null, total: 1 });
  });

  describe('pagination', () => {
    const seed = async (count: number) => {
      for (let i = 0; i < count; i++) {
        await request('/', { body: { name: `G${i}`, sort: i }, method: 'POST' });
      }
    };

    it('pages with limit + cursor until nextCursor is null', async () => {
      await seed(3);

      const first = await json(await request('/?limit=2'));
      expect(first.items).toHaveLength(2);
      expect(first).toMatchObject({ hasMore: true, total: 3 });
      expect(first.nextCursor).toEqual(expect.any(String));

      const second = await json(
        await request(`/?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`),
      );
      expect(second).toMatchObject({ hasMore: false, nextCursor: null, total: 3 });
      expect(second.items).toHaveLength(1);

      const seen = [...first.items, ...second.items].map((group: { id: string }) => group.id);
      expect(new Set(seen).size).toBe(3);
    });

    it('rejects a cursor it did not issue as a validation error', async () => {
      const res = await request('/?cursor=not-a-cursor');
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        code: 'validation_error',
        success: false,
      });
    });

    it('rejects a limit above the maximum', async () => {
      const res = await request('/?limit=101');
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ code: 'validation_error' });
    });

    it('still answers the legacy bare array of every group for format=array', async () => {
      await seed(3);

      const legacy = await json(await request('/?format=array&limit=1'));
      expect(Array.isArray(legacy)).toBe(true);
      expect(legacy).toHaveLength(3);
      expect(() => AgentGroupSchema.array().parse(legacy)).not.toThrow();
    });
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
