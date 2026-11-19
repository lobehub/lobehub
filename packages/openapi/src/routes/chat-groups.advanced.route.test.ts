// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Chat group duplicate / member creation / member update over real HTTP on
 * PGlite: real auth, workspace and scope middlewares, controller, REST service
 * and the shared `agentGroup` procedures. API keys are real `api_keys` rows.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { agents, apiKeys, users } = await import('@/database/schemas');
const { buildRouteApp, json, seedUsersAndKeys } = await import('./__tests__/pglite-harness');
const { ChatGroupSchema, CreatedChatGroupAgentsSchema } = await import('../types/chat-group.type');
const ChatGroupRoutes = (await import('./chat-groups.route')).default;

const serverDB = await getTestDB();
holder.serverDB = serverDB;

const { call } = buildRouteApp({ 'chat-groups': ChatGroupRoutes });

const OWNER = 'r8-group-owner';
const STRANGER = 'r8-group-stranger';
const MEMBER = 'agt_r8_group_member';

const KEYS = {
  chatOnly: 'sk-lh-r8groupchatonly1',
  ownerRead: 'sk-lh-r8groupownerread',
  ownerWrite: 'sk-lh-r8groupownerwrit',
  stranger: 'sk-lh-r8groupstranger1',
} as const;

const createGroup = async (key: string = KEYS.ownerWrite, members: string[] = []) => {
  const res = await call('/chat-groups', {
    body: { members: members.map((agentId) => ({ agentId })), title: 'Research team' },
    key,
    method: 'POST',
  });
  expect(res.status).toBe(201);
  return ChatGroupSchema.parse((await json(res)).data);
};

beforeEach(async () => {
  await serverDB.delete(apiKeys);
  await serverDB.delete(users);
  await seedUsersAndKeys(
    serverDB,
    [OWNER, STRANGER],
    [
      [KEYS.ownerWrite, OWNER, ['agent:write']],
      [KEYS.ownerRead, OWNER, ['agent:read']],
      [KEYS.chatOnly, OWNER, ['chat:write']],
      [KEYS.stranger, STRANGER, null],
    ],
  );
  await serverDB.insert(agents).values([{ id: MEMBER, title: 'Analyst', userId: OWNER }]);
});

describe('authentication, API-key scopes and workspace header', () => {
  it('answers 401 without credentials', async () => {
    const group = await createGroup();
    expect(
      (await call(`/chat-groups/${group.id}/duplicate`, { body: {}, method: 'POST' })).status,
    ).toBe(401);
  });

  it('refuses a key without agent:write', async () => {
    const group = await createGroup();
    for (const key of [KEYS.chatOnly, KEYS.ownerRead]) {
      const res = await call(`/chat-groups/${group.id}/agents`, {
        body: { agents: [{ title: 'Writer' }] },
        key,
        method: 'POST',
      });
      expect(res.status).toBe(403);
      expect((await json(res)).code).toBe('insufficient_scope');
    }
  });

  it('rejects an X-Workspace-Id the personal key does not belong to', async () => {
    const group = await createGroup();
    const res = await call(`/chat-groups/${group.id}/duplicate`, {
      body: {},
      headers: { 'X-Workspace-Id': 'ws_other' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
  });
});

describe('request validation', () => {
  it('rejects an empty agent batch, an untitled agent and unknown fields', async () => {
    const group = await createGroup();
    const empty = await call(`/chat-groups/${group.id}/agents`, {
      body: { agents: [] },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(empty.status).toBe(400);
    expect(JSON.stringify(await json(empty))).toContain('At least one agent is required');

    const untitled = await call(`/chat-groups/${group.id}/agents`, {
      body: { agents: [{ systemRole: 'x' }] },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(untitled.status).toBe(400);

    const smuggled = await call(`/chat-groups/${group.id}/agents`, {
      body: { agents: [{ title: 'W', userId: STRANGER }] },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(smuggled.status).toBe(400);
  });

  it('rejects an empty member update and the supervisor role', async () => {
    const group = await createGroup(KEYS.ownerWrite, [MEMBER]);
    const empty = await call(`/chat-groups/${group.id}/members/${MEMBER}`, {
      body: {},
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(empty.status).toBe(400);
    expect(JSON.stringify(await json(empty))).toContain('Provide at least one');

    const supervisor = await call(`/chat-groups/${group.id}/members/${MEMBER}`, {
      body: { role: 'supervisor' },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(supervisor.status).toBe(400);
  });
});

describe('advanced group operations', () => {
  it('duplicates a group with a new title', async () => {
    const group = await createGroup(KEYS.ownerWrite, [MEMBER]);

    const res = await call(`/chat-groups/${group.id}/duplicate`, {
      body: { title: 'Research team (copy)' },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(res.status).toBe(201);
    const copy = ChatGroupSchema.parse((await json(res)).data);
    expect(copy.id).not.toBe(group.id);
    expect(copy.title).toBe('Research team (copy)');
    // referenced (non-virtual) members are referenced again, not copied
    expect(copy.members.map((member) => member.agentId)).toContain(MEMBER);
    expect(copy.members.find((member) => member.role === 'supervisor')?.agentId).not.toBe(
      group.members.find((member) => member.role === 'supervisor')?.agentId,
    );
  });

  it('creates member agents inside the group', async () => {
    const group = await createGroup();

    const res = await call(`/chat-groups/${group.id}/agents`, {
      body: { agents: [{ title: 'Writer' }, { systemRole: 'Check facts', title: 'Checker' }] },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(res.status).toBe(201);
    const created = CreatedChatGroupAgentsSchema.parse((await json(res)).data);
    expect(created.agentIds).toHaveLength(2);
    expect(created.chatGroup.members.map((member) => member.agentId)).toEqual(
      expect.arrayContaining(created.agentIds),
    );

    const rows = await serverDB.query.agents.findMany({
      where: (table, { inArray }) => inArray(table.id, created.agentIds),
    });
    expect(rows.every((row) => row.virtual === true && row.userId === OWNER)).toBe(true);
  });

  it('updates one member', async () => {
    const group = await createGroup(KEYS.ownerWrite, [MEMBER]);

    const res = await call(`/chat-groups/${group.id}/members/${MEMBER}`, {
      body: { enabled: false, order: 3, role: 'assistant' },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(res.status).toBe(200);
    const member = ChatGroupSchema.parse((await json(res)).data).members.find(
      (item) => item.agentId === MEMBER,
    );
    expect(member).toEqual({ agentId: MEMBER, enabled: false, order: 3, role: 'assistant' });
  });

  it('refuses to change the supervisor’s role and answers 404 for a non-member', async () => {
    const group = await createGroup();
    const supervisor = group.members.find((member) => member.role === 'supervisor')!.agentId;

    const role = await call(`/chat-groups/${group.id}/members/${supervisor}`, {
      body: { role: 'participant' },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(role.status).toBe(400);

    const missing = await call(`/chat-groups/${group.id}/members/agt_not_a_member`, {
      body: { enabled: false },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(missing.status).toBe(404);
  });
});

describe('another account’s group reads as missing', () => {
  it('refuses to duplicate, add to, or update a stranger’s group', async () => {
    const theirs = await createGroup(KEYS.stranger);
    const supervisor = theirs.members.find((member) => member.role === 'supervisor')!.agentId;

    const duplicate = await call(`/chat-groups/${theirs.id}/duplicate`, {
      body: {},
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(duplicate.status).toBe(404);

    const add = await call(`/chat-groups/${theirs.id}/agents`, {
      body: { agents: [{ title: 'Mole' }] },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(add.status).toBe(404);

    const update = await call(`/chat-groups/${theirs.id}/members/${supervisor}`, {
      body: { enabled: false },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(update.status).toBe(404);

    const still = await call(`/chat-groups/${theirs.id}`, { key: KEYS.stranger });
    expect((await json(still)).data.members).toHaveLength(1);
  });
});
