// @vitest-environment node
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { agents, chatGroups, users } from '@/database/schemas';

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

const { default: ChatGroupRoutes } = await import('./chat-groups.route');

const USER = 'chat-group-user';
const OTHER = 'chat-group-other';

const request = (
  path: string,
  init: { body?: unknown; method?: string; scopes?: string[]; userId?: string } = {},
) => {
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.set('userId' as never, (init.userId ?? USER) as never);
    if (init.scopes) {
      c.set('authType' as never, 'apikey' as never);
      c.set('apiKeyScopes' as never, init.scopes as never);
    }
    await next();
  });
  app.route('/', ChatGroupRoutes);

  return app.request(path, {
    ...(init.body === undefined
      ? {}
      : { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } }),
    method: init.method ?? 'GET',
  });
};

const json = async (res: Response) => ((await res.json()) as { data: any }).data;

const createGroup = async (body: Record<string, unknown>) => {
  const res = await request('/', { body, method: 'POST' });
  expect(res.status).toBe(201);
  return json(res);
};

beforeEach(async () => {
  await db.delete(chatGroups);
  await db.delete(agents);
  await db.delete(users);
  await db.insert(users).values([{ id: USER }, { id: OTHER }]);
  await db.insert(agents).values([
    { id: 'agt_a', slug: 'agt-a', title: 'A', userId: USER },
    { id: 'agt_b', slug: 'agt-b', title: 'B', userId: USER },
    { id: 'agt_c', slug: 'agt-c', title: 'C', userId: USER },
    { id: 'agt_other', slug: 'agt-other', title: 'Other', userId: OTHER },
  ]);
});

describe('POST /chat-groups', () => {
  it('creates a group with a supervisor plus the requested members, projected publicly', async () => {
    const group = await createGroup({
      avatar: '🤖',
      backgroundColor: '#000',
      members: [{ agentId: 'agt_a' }, { agentId: 'agt_b', role: 'assistant' }],
      title: 'Toby crew',
    });

    expect(Object.keys(group).sort()).toEqual(
      [
        'avatar',
        'backgroundColor',
        'createdAt',
        'description',
        'id',
        'members',
        'personal',
        'pinned',
        'title',
        'updatedAt',
      ].sort(),
    );
    expect(group).toMatchObject({
      avatar: '🤖',
      backgroundColor: '#000',
      personal: false,
      title: 'Toby crew',
    });

    const [supervisor, ...members] = group.members;
    expect(supervisor).toMatchObject({ order: -1, role: 'supervisor' });
    expect(Object.keys(supervisor).sort()).toEqual(['agentId', 'enabled', 'order', 'role']);
    expect(members).toEqual([
      { agentId: 'agt_a', enabled: true, order: 0, role: 'participant' },
      { agentId: 'agt_b', enabled: true, order: 1, role: 'assistant' },
    ]);
  });

  it('rolls the group back when a member is not visible to the caller', async () => {
    const res = await request('/', {
      body: { members: [{ agentId: 'agt_a' }, { agentId: 'agt_other' }], title: 'Leaky' },
      method: 'POST',
    });

    expect(res.status).toBe(404);
    expect(await db.select().from(chatGroups)).toHaveLength(0);
    expect(await db.select().from(agents).where(eq(agents.virtual, true))).toHaveLength(0);
  });

  it('answers 409 on a clientId retry without leaving another supervisor behind', async () => {
    await createGroup({ clientId: 'toby-1', members: [{ agentId: 'agt_a' }], title: 'Once' });

    const res = await request('/', {
      body: { clientId: 'toby-1', members: [{ agentId: 'agt_a' }], title: 'Twice' },
      method: 'POST',
    });

    expect(res.status).toBe(409);
    expect(await db.select().from(chatGroups)).toHaveLength(1);
    expect(await db.select().from(agents).where(eq(agents.virtual, true))).toHaveLength(1);
  });

  it('refuses a supervisor role for an existing agent', async () => {
    const res = await request('/', {
      body: { members: [{ agentId: 'agt_a', role: 'supervisor' }], title: 'Coup' },
      method: 'POST',
    });

    expect(res.status).toBe(400);
  });

  it('rejects an API key without an agent create scope', async () => {
    const res = await request('/', {
      body: { members: [], title: 'Nope' },
      method: 'POST',
      scopes: ['agent:read'],
    });

    expect(res.status).toBe(403);
  });
});

describe('GET /chat-groups', () => {
  it('lists the caller groups with members and paginates', async () => {
    await createGroup({ members: [{ agentId: 'agt_a' }], title: 'First' });
    await createGroup({ members: [{ agentId: 'agt_b' }], title: 'Second' });

    const all = await json(await request('/'));
    expect(all.total).toBe(2);
    expect(all.chatGroups).toHaveLength(2);
    for (const group of all.chatGroups) {
      expect(group.members.map((m: any) => m.role)).toEqual(['supervisor', 'participant']);
      expect(group).not.toHaveProperty('config');
      expect(group).not.toHaveProperty('userId');
    }

    const page = await json(await request('/?page=2&pageSize=1'));
    expect(page.total).toBe(2);
    expect(page.chatGroups).toHaveLength(1);
  });

  it('hides another user groups', async () => {
    const group = await createGroup({ members: [{ agentId: 'agt_a' }], title: 'Mine' });

    expect(await json(await request('/', { userId: OTHER }))).toEqual({
      chatGroups: [],
      total: 0,
    });
    expect((await request(`/${group.id}`, { userId: OTHER })).status).toBe(404);
  });
});

describe('GET /chat-groups/:id', () => {
  it('returns the group, or 404 for an unknown id', async () => {
    const group = await createGroup({ members: [{ agentId: 'agt_a' }], title: 'Solo' });

    expect(await json(await request(`/${group.id}`))).toEqual(group);
    expect((await request('/missing')).status).toBe(404);
  });
});

describe('PATCH /chat-groups/:id', () => {
  it('updates the public fields only', async () => {
    const group = await createGroup({ members: [{ agentId: 'agt_a' }], title: 'Old' });

    const res = await request(`/${group.id}`, {
      body: { description: 'desc', pinned: true, title: 'New' },
      method: 'PATCH',
    });

    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ description: 'desc', pinned: true, title: 'New' });
  });

  it('returns 404 for another user group', async () => {
    const group = await createGroup({ members: [{ agentId: 'agt_a' }], title: 'Mine' });

    const res = await request(`/${group.id}`, {
      body: { title: 'Hijack' },
      method: 'PATCH',
      userId: OTHER,
    });

    expect(res.status).toBe(404);
  });
});

describe('/chat-groups/:id/members', () => {
  it('adds and removes members without deleting standalone agents', async () => {
    const group = await createGroup({ members: [{ agentId: 'agt_a' }], title: 'Roster' });

    const added = await json(
      await request(`/${group.id}/members`, {
        body: { agentIds: ['agt_b', 'agt_c'] },
        method: 'POST',
      }),
    );
    expect(added.members.map((m: any) => m.agentId).slice(1)).toEqual(['agt_a', 'agt_b', 'agt_c']);

    const removed = await json(
      await request(`/${group.id}/members`, { body: { agentIds: ['agt_b'] }, method: 'DELETE' }),
    );
    expect(removed.members.map((m: any) => m.agentId).slice(1)).toEqual(['agt_a', 'agt_c']);
    expect(await db.select().from(agents).where(eq(agents.id, 'agt_b'))).toHaveLength(1);
  });

  it('refuses to remove the supervisor', async () => {
    const group = await createGroup({ members: [{ agentId: 'agt_a' }], title: 'Roster' });
    const supervisorId = group.members[0].agentId;

    const res = await request(`/${group.id}/members`, {
      body: { agentIds: [supervisorId] },
      method: 'DELETE',
    });

    expect(res.status).toBe(400);
    expect((await json(await request(`/${group.id}`))).members).toHaveLength(2);
  });

  it('refuses another user agent', async () => {
    const group = await createGroup({ members: [{ agentId: 'agt_a' }], title: 'Roster' });

    const res = await request(`/${group.id}/members`, {
      body: { agentIds: ['agt_other'] },
      method: 'POST',
    });

    expect(res.status).toBe(404);
  });

  it('rejects an empty agentIds list', async () => {
    const group = await createGroup({ members: [], title: 'Roster' });

    const res = await request(`/${group.id}/members`, { body: { agentIds: [] }, method: 'POST' });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /chat-groups/:id', () => {
  it('deletes the group and its supervisor but keeps member agents', async () => {
    const group = await createGroup({ members: [{ agentId: 'agt_a' }], title: 'Doomed' });
    const supervisorId = group.members[0].agentId;

    const res = await request(`/${group.id}`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect((await request(`/${group.id}`)).status).toBe(404);
    expect(await db.select().from(agents).where(eq(agents.id, supervisorId))).toHaveLength(0);
    expect(await db.select().from(agents).where(eq(agents.id, 'agt_a'))).toHaveLength(1);
  });

  it('returns 404 for an unknown group', async () => {
    expect((await request('/missing', { method: 'DELETE' })).status).toBe(404);
  });
});

describe('personal chat groups', () => {
  it('creates a personal group and stores the flag in config', async () => {
    const group = await createGroup({
      members: [{ agentId: 'agt_a' }],
      personal: true,
      title: 'Personal',
    });

    expect(group.personal).toBe(true);
    const [row] = await db.select().from(chatGroups).where(eq(chatGroups.id, group.id));
    expect(row.config).toEqual({ personal: true });
  });

  it('filters the list by personal', async () => {
    const personal = await createGroup({
      members: [{ agentId: 'agt_a' }],
      personal: true,
      title: 'Personal',
    });
    const other = await createGroup({ members: [{ agentId: 'agt_b' }], title: 'Other' });

    const ids = async (query: string) =>
      (await json(await request(`/${query}`))).chatGroups.map((group: { id: string }) => group.id);

    expect(await ids('?personal=true')).toEqual([personal.id]);
    expect(await ids('?personal=false')).toEqual([other.id]);
    expect((await ids('')).sort()).toEqual([personal.id, other.id].sort());

    const page = await json(await request('/?personal=true&pageSize=1'));
    expect(page.total).toBe(1);
  });

  it('rejects a personal filter that is not a boolean', async () => {
    expect((await request('/?personal=yes')).status).toBe(400);
  });

  it('toggles the flag without dropping the rest of config', async () => {
    const group = await createGroup({ members: [{ agentId: 'agt_a' }], title: 'Crew' });
    await db
      .update(chatGroups)
      .set({ config: { allowDM: true, systemPrompt: 'keep me' } })
      .where(eq(chatGroups.id, group.id));

    const res = await request(`/${group.id}`, {
      body: { personal: true, title: 'Renamed' },
      method: 'PATCH',
    });

    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ personal: true, title: 'Renamed' });
    const [row] = await db.select().from(chatGroups).where(eq(chatGroups.id, group.id));
    expect(row.config).toEqual({ allowDM: true, personal: true, systemPrompt: 'keep me' });

    const cleared = await json(
      await request(`/${group.id}`, { body: { personal: false }, method: 'PATCH' }),
    );
    expect(cleared.personal).toBe(false);
  });
});
