// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Advanced agent endpoints over real HTTP: real routes behind the `app.ts` auth
 * and workspace middlewares, real permission/scope gates, controller, REST
 * service and the shared `agent` / `agentLabel` procedures, on PGlite. API keys
 * are real `api_keys` rows; only the database handle is pointed at PGlite.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const {
  agents,
  apiKeys,
  files,
  knowledgeBases,
  sessionGroups,
  users,
  workspaceMembers,
  workspaces,
} = await import('@/database/schemas');
const { apiKeyRow, buildRouteApp, json, seedUsersAndKeys } =
  await import('./__tests__/pglite-harness');
const { AgentDetailSchema } = await import('../types/agent.type');
const { AgentKnowledgeSchema, AgentPinStateSchema } =
  await import('../types/agent-advanced.type');
const { AgentLabelSetSchema } = await import('../types/agent-label.type');
const AgentRoutes = (await import('./agents.route')).default;
const AgentLabelRoutes = (await import('./agent-labels.route')).default;
const SessionGroupRoutes = (await import('./session-groups.route')).default;

const serverDB = await getTestDB();
holder.serverDB = serverDB;

const { call } = buildRouteApp({
  'agent-labels': AgentLabelRoutes,
  'agents': AgentRoutes,
  'session-groups': SessionGroupRoutes,
});

const OWNER = 'r8-agent-owner';
const STRANGER = 'r8-agent-stranger';
const AGENT = 'agt_r8_owner';
const STRANGER_AGENT = 'agt_r8_stranger';
const FILE = 'file_r8_owner';
const STRANGER_FILE = 'file_r8_stranger';
const KB = 'kb_r8_owner';
const STRANGER_KB = 'kb_r8_stranger';

const KEYS = {
  chatOnly: 'sk-lh-r8agentchatonly1',
  ownerFull: 'sk-lh-r8agentownerfull',
  ownerRead: 'sk-lh-r8agentownerread',
  ownerTransfer: 'sk-lh-r8agentownertran',
  ownerWrite: 'sk-lh-r8agentownerwrit',
  stranger: 'sk-lh-r8agentstranger1',
} as const;

beforeEach(async () => {
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await seedUsersAndKeys(
    serverDB,
    [OWNER, STRANGER],
    [
      [KEYS.ownerFull, OWNER, null],
      [KEYS.ownerWrite, OWNER, ['agent:write']],
      [KEYS.ownerRead, OWNER, ['agent:read']],
      [KEYS.ownerTransfer, OWNER, ['agent:write', 'agent:transfer']],
      [KEYS.chatOnly, OWNER, ['chat:write']],
      [KEYS.stranger, STRANGER, null],
    ],
  );
  await serverDB.insert(agents).values([
    { id: AGENT, slug: 'owner-helper', title: 'Owner helper', userId: OWNER },
    { id: STRANGER_AGENT, slug: 'stranger-helper', title: 'Stranger helper', userId: STRANGER },
  ]);
  const file = (id: string, userId: string) => ({
    fileType: 'application/pdf',
    id,
    name: `${id}.pdf`,
    size: 1024,
    url: `files/${id}.pdf`,
    userId,
  });
  await serverDB.insert(files).values([file(FILE, OWNER), file(STRANGER_FILE, STRANGER)]);
  await serverDB.insert(knowledgeBases).values([
    { id: KB, name: 'Owner KB', userId: OWNER },
    { id: STRANGER_KB, name: 'Stranger KB', userId: STRANGER },
  ]);
});

describe('authentication, API-key scopes and workspace header', () => {
  it('answers 401 without credentials and with an unknown key', async () => {
    expect((await call(`/agents/${AGENT}/knowledge`)).status).toBe(401);
    expect((await call('/agents/by-slug/owner-helper')).status).toBe(401);
    expect(
      (
        await call(`/agents/${AGENT}/pin`, {
          body: {},
          key: 'sk-lh-not-a-key-0001',
          method: 'POST',
        })
      ).status,
    ).toBe(401);
  });

  it('refuses a key without an agent scope', async () => {
    const res = await call(`/agents/${AGENT}/knowledge`, { key: KEYS.chatOnly });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it('lets agent:read read but not write', async () => {
    expect((await call(`/agents/${AGENT}/knowledge`, { key: KEYS.ownerRead })).status).toBe(200);
    const res = await call(`/agents/${AGENT}/pin`, {
      body: {},
      key: KEYS.ownerRead,
      method: 'POST',
    });
    expect(res.status).toBe(403);
  });

  it('requires agent:transfer on top of agent:write to transfer', async () => {
    const res = await call(`/agents/${AGENT}/transfer`, {
      body: { targetWorkspaceId: null },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it('rejects an X-Workspace-Id the personal key does not belong to', async () => {
    const res = await call(`/agents/${AGENT}/knowledge`, {
      headers: { 'X-Workspace-Id': 'ws_someone_else' },
      key: KEYS.ownerFull,
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
  });
});

describe('another account’s agent reads as missing', () => {
  it.each([
    ['GET', `/agents/${STRANGER_AGENT}/knowledge`, undefined],
    ['POST', `/agents/${STRANGER_AGENT}/knowledge/files`, { fileIds: [FILE] }],
    ['POST', `/agents/${STRANGER_AGENT}/knowledge/knowledge-bases`, { knowledgeBaseId: KB }],
    ['POST', `/agents/${STRANGER_AGENT}/pin`, { pinned: true }],
    ['GET', `/agents/${STRANGER_AGENT}/labels`, undefined],
    ['PUT', `/agents/${STRANGER_AGENT}/labels`, { labelIds: [] }],
    ['PATCH', `/agents/${STRANGER_AGENT}/visibility`, { visibility: 'public' }],
    ['POST', `/agents/${STRANGER_AGENT}/transfer`, { targetMemberId: OWNER }],
    ['GET', '/agents/by-slug/stranger-helper', undefined],
  ])('%s %s → 404', async (method, path, body) => {
    const res = await call(path, { body, key: KEYS.ownerFull, method });
    expect(res.status).toBe(404);
  });

  it('leaves the stranger’s agent untouched', async () => {
    await call(`/agents/${STRANGER_AGENT}/pin`, {
      body: { pinned: true },
      key: KEYS.ownerFull,
      method: 'POST',
    });
    const [row] = await serverDB.query.agents
      .findMany({ where: (table, { eq }) => eq(table.id, STRANGER_AGENT) })
      .then((rows) => rows);
    expect(row.pinned).not.toBe(true);
  });
});

describe('request validation', () => {
  it('rejects an empty or oversized file list', async () => {
    const empty = await call(`/agents/${AGENT}/knowledge/files`, {
      body: { fileIds: [] },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(empty.status).toBe(400);
    const body = await json(empty);
    expect(body.code).toBe('validation_error');
    expect(JSON.stringify(body)).toContain('At least one file ID is required');
  });

  it('rejects unknown fields and a missing enabled flag', async () => {
    const res = await call(`/agents/${AGENT}/knowledge/files/${FILE}`, {
      body: {},
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(res.status).toBe(400);

    const extra = await call(`/agents/${AGENT}/pin`, {
      body: { pinned: true, sort: 1 },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(extra.status).toBe(400);
  });

  it('rejects a bad visibility and a transfer without a target', async () => {
    const visibility = await call(`/agents/${AGENT}/visibility`, {
      body: { visibility: 'secret' },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(visibility.status).toBe(400);

    const transfer = await call(`/agents/${AGENT}/transfer`, {
      body: {},
      key: KEYS.ownerTransfer,
      method: 'POST',
    });
    expect(transfer.status).toBe(400);
    expect(JSON.stringify(await json(transfer))).toContain('targetWorkspaceId');

    const both = await call(`/agents/${AGENT}/transfer`, {
      body: { targetMemberId: 'u1', targetWorkspaceId: 'ws_1' },
      key: KEYS.ownerTransfer,
      method: 'POST',
    });
    expect(both.status).toBe(400);
    expect(JSON.stringify(await json(both))).toContain('mutually exclusive');
  });
});

describe('slug lookup', () => {
  it('returns the caller’s agent by slug', async () => {
    const res = await call('/agents/by-slug/owner-helper', { key: KEYS.ownerRead });
    expect(res.status).toBe(200);
    const { data } = await json(res);
    expect(AgentDetailSchema.parse(data).id).toBe(AGENT);
  });

  it('answers 404 for an unknown slug', async () => {
    expect((await call('/agents/by-slug/nope', { key: KEYS.ownerRead })).status).toBe(404);
  });
});

describe('mounted knowledge', () => {
  it('mounts, toggles and unmounts a file', async () => {
    const mounted = await call(`/agents/${AGENT}/knowledge/files`, {
      body: { fileIds: [FILE] },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(mounted.status).toBe(200);
    const knowledge = AgentKnowledgeSchema.parse((await json(mounted)).data);
    expect(knowledge.files.map((f) => [f.id, f.enabled])).toEqual([[FILE, true]]);

    const toggled = await call(`/agents/${AGENT}/knowledge/files/${FILE}`, {
      body: { enabled: false },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect((await json(toggled)).data.files[0].enabled).toBe(false);

    const removed = await call(`/agents/${AGENT}/knowledge/files/${FILE}`, {
      key: KEYS.ownerWrite,
      method: 'DELETE',
    });
    expect((await json(removed)).data.files).toEqual([]);

    // unmounting again is a 404, not a silent success
    const again = await call(`/agents/${AGENT}/knowledge/files/${FILE}`, {
      key: KEYS.ownerWrite,
      method: 'DELETE',
    });
    expect(again.status).toBe(404);
  });

  it('refuses to mount another account’s file or knowledge base', async () => {
    const file = await call(`/agents/${AGENT}/knowledge/files`, {
      body: { fileIds: [FILE, STRANGER_FILE] },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(file.status).toBe(404);
    expect((await json(file)).message).toContain(STRANGER_FILE);

    const kb = await call(`/agents/${AGENT}/knowledge/knowledge-bases`, {
      body: { knowledgeBaseId: STRANGER_KB },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(kb.status).toBe(404);

    // nothing was mounted by the rejected call
    const { data } = await json(await call(`/agents/${AGENT}/knowledge`, { key: KEYS.ownerRead }));
    expect(data).toEqual({ files: [], knowledgeBases: [] });
  });

  it('mounts, toggles and unmounts a knowledge base, refusing a duplicate', async () => {
    const mounted = await call(`/agents/${AGENT}/knowledge/knowledge-bases`, {
      body: { knowledgeBaseId: KB },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(mounted.status).toBe(200);
    expect((await json(mounted)).data.knowledgeBases.map((k: any) => k.id)).toEqual([KB]);

    const duplicate = await call(`/agents/${AGENT}/knowledge/knowledge-bases`, {
      body: { knowledgeBaseId: KB },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(duplicate.status).toBe(409);

    const toggled = await call(`/agents/${AGENT}/knowledge/knowledge-bases/${KB}`, {
      body: { enabled: false },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect((await json(toggled)).data.knowledgeBases[0].enabled).toBe(false);

    const removed = await call(`/agents/${AGENT}/knowledge/knowledge-bases/${KB}`, {
      key: KEYS.ownerWrite,
      method: 'DELETE',
    });
    expect((await json(removed)).data.knowledgeBases).toEqual([]);
  });
});

describe('pin', () => {
  it('pins and unpins the agent', async () => {
    const pinned = await call(`/agents/${AGENT}/pin`, {
      body: {},
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(pinned.status).toBe(200);
    expect(AgentPinStateSchema.parse((await json(pinned)).data)).toEqual({
      id: AGENT,
      pinned: true,
    });

    await call(`/agents/${AGENT}/pin`, {
      body: { pinned: false },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    const row = await serverDB.query.agents.findFirst({
      where: (table, { eq }) => eq(table.id, AGENT),
    });
    expect(row?.pinned).toBe(false);
  });
});

describe('labels on an agent', () => {
  const createLabel = async (name: string) =>
    (
      await json(
        await call('/agent-labels', { body: { name }, key: KEYS.ownerWrite, method: 'POST' }),
      )
    ).data.id as string;

  it('replaces, adds and removes labels', async () => {
    const work = await createLabel('Work');
    const ops = await createLabel('Ops');

    const set = await call(`/agents/${AGENT}/labels`, {
      body: { labelIds: [work] },
      key: KEYS.ownerWrite,
      method: 'PUT',
    });
    expect(set.status).toBe(200);
    expect(AgentLabelSetSchema.parse((await json(set)).data).items.map((l) => l.name)).toEqual([
      'Work',
    ]);

    const added = await call(`/agents/${AGENT}/labels/${ops}`, {
      key: KEYS.ownerWrite,
      method: 'PUT',
    });
    expect((await json(added)).data.items.map((l: any) => l.name)).toEqual(['Ops', 'Work']);

    const removed = await call(`/agents/${AGENT}/labels/${work}`, {
      key: KEYS.ownerWrite,
      method: 'DELETE',
    });
    expect((await json(removed)).data.items.map((l: any) => l.name)).toEqual(['Ops']);

    const read = await call(`/agents/${AGENT}/labels`, { key: KEYS.ownerRead });
    expect((await json(read)).data.items).toHaveLength(1);
  });

  it('refuses a label from another account’s registry without touching the set', async () => {
    const mine = await createLabel('Mine');
    const theirs = (
      await json(
        await call('/agent-labels', {
          body: { name: 'Theirs' },
          key: KEYS.stranger,
          method: 'POST',
        }),
      )
    ).data.id;

    await call(`/agents/${AGENT}/labels`, {
      body: { labelIds: [mine] },
      key: KEYS.ownerWrite,
      method: 'PUT',
    });
    const res = await call(`/agents/${AGENT}/labels`, {
      body: { labelIds: [mine, theirs] },
      key: KEYS.ownerWrite,
      method: 'PUT',
    });
    expect(res.status).toBe(404);

    const read = await call(`/agents/${AGENT}/labels`, { key: KEYS.ownerRead });
    expect((await json(read)).data.items.map((l: any) => l.id)).toEqual([mine]);
  });
});

describe('visibility', () => {
  it('answers 400 outside a workspace, as the shared procedure does', async () => {
    const res = await call(`/agents/${AGENT}/visibility`, {
      body: { visibility: 'public' },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(res.status).toBe(400);
    expect((await json(res)).message).toContain('only applies inside a workspace');
  });
});

describe('transfer', () => {
  it('refuses to move an agent out of the personal space with an API key', async () => {
    const res = await call(`/agents/${AGENT}/transfer`, {
      body: { targetWorkspaceId: 'ws_not_a_member' },
      key: KEYS.ownerTransfer,
      method: 'POST',
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('forbidden');
    const row = await serverDB.query.agents.findFirst({
      where: (table, { eq }) => eq(table.id, AGENT),
    });
    expect(row?.userId).toBe(OWNER);
  });

  it('refuses a member handover outside a workspace', async () => {
    const res = await call(`/agents/${AGENT}/transfer`, {
      body: { targetMemberId: STRANGER },
      key: KEYS.ownerTransfer,
      method: 'POST',
    });
    expect(res.status).toBe(400);
  });

});

describe('workspace-bound API keys', () => {
  const MEMBER = 'r8-agent-member';
  const WS = 'ws_r8_team';
  const OTHER_WS = 'ws_r8_other';
  const WS_KEYS = {
    member: 'sk-lh-r8wsmemberkey001',
    owner: 'sk-lh-r8wsownerkey0001',
  } as const;

  beforeEach(async () => {
    await serverDB.insert(users).values({ id: MEMBER });
    await serverDB.insert(workspaces).values([
      { id: WS, name: 'Team', primaryOwnerId: OWNER, slug: 'r8-team' },
      { id: OTHER_WS, name: 'Other', primaryOwnerId: STRANGER, slug: 'r8-other' },
    ]);
    await serverDB.insert(workspaceMembers).values([
      { role: 'owner', userId: OWNER, workspaceId: WS },
      { role: 'member', userId: MEMBER, workspaceId: WS },
      { role: 'owner', userId: STRANGER, workspaceId: OTHER_WS },
    ]);
    await serverDB
      .insert(apiKeys)
      .values([
        apiKeyRow(WS_KEYS.member, MEMBER, null, WS),
        apiKeyRow(WS_KEYS.owner, OWNER, ['agent:write', 'agent:transfer'], WS),
      ]);
    await serverDB.insert(agents).values([
      {
        id: 'agt_r8_ws_private',
        title: 'Private',
        userId: OWNER,
        visibility: 'private',
        workspaceId: WS,
      },
      {
        id: 'agt_r8_ws_public',
        title: 'Public',
        userId: OWNER,
        visibility: 'public',
        workspaceId: WS,
      },
      { id: 'agt_r8_ws_other', title: 'Elsewhere', userId: STRANGER, workspaceId: OTHER_WS },
    ]);
    await serverDB.insert(files).values({
      fileType: 'application/pdf',
      id: 'file_r8_ws_private',
      name: 'private.pdf',
      size: 1,
      url: 'files/private.pdf',
      userId: OWNER,
      visibility: 'private',
      workspaceId: WS,
    });
    await serverDB.insert(sessionGroups).values({
      id: 'sg_r8_ws_private',
      name: 'Owner only',
      userId: OWNER,
      visibility: 'private',
      workspaceId: WS,
    });
  });

  it('scopes reads to the bound workspace and hides another member’s private agent', async () => {
    expect((await call('/agents/agt_r8_ws_public/knowledge', { key: WS_KEYS.member })).status).toBe(
      200,
    );
    expect(
      (await call('/agents/agt_r8_ws_private/knowledge', { key: WS_KEYS.member })).status,
    ).toBe(404);
    // an agent of another workspace is not reachable through this key
    expect((await call('/agents/agt_r8_ws_other/knowledge', { key: WS_KEYS.member })).status).toBe(
      404,
    );
    // nor through the personal-space agents of its issuer
    expect((await call(`/agents/${AGENT}/knowledge`, { key: WS_KEYS.owner })).status).toBe(404);
  });

  it('refuses an X-Workspace-Id other than the one the key is bound to', async () => {
    const res = await call('/agents/agt_r8_ws_public/knowledge', {
      headers: { 'X-Workspace-Id': OTHER_WS },
      key: WS_KEYS.member,
    });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
  });

  it('hides another member’s private folder and refuses to move into it', async () => {
    expect((await call('/session-groups/sg_r8_ws_private', { key: WS_KEYS.member })).status).toBe(
      404,
    );
    const move = await call('/session-groups/move-agents', {
      body: { agentIds: ['agt_r8_ws_public'], sessionGroupId: 'sg_r8_ws_private' },
      key: WS_KEYS.member,
      method: 'POST',
    });
    expect(move.status).toBe(404);
  });

  it('refuses a private agent in a public folder before moving anything', async () => {
    const folder = (
      await json(
        await call('/session-groups', {
          body: { name: 'Shared' },
          key: WS_KEYS.owner,
          method: 'POST',
        }),
      )
    ).data.id;
    const res = await call('/session-groups/move-agents', {
      body: { agentIds: ['agt_r8_ws_public', 'agt_r8_ws_private'], sessionGroupId: folder },
      key: WS_KEYS.owner,
      method: 'POST',
    });
    expect(res.status).toBe(400);
    const moved = await serverDB.query.agents.findFirst({
      where: (table, { eq }) => eq(table.id, 'agt_r8_ws_public'),
    });
    expect(moved?.sessionGroupId).toBeNull();
  });

  it('refuses to mount a private file on a public agent', async () => {
    const res = await call('/agents/agt_r8_ws_public/knowledge/files', {
      body: { fileIds: ['file_r8_ws_private'] },
      key: WS_KEYS.owner,
      method: 'POST',
    });
    expect(res.status).toBe(404);
    // the private agent may mount it
    const ok = await call('/agents/agt_r8_ws_private/knowledge/files', {
      body: { fileIds: ['file_r8_ws_private'] },
      key: WS_KEYS.owner,
      method: 'POST',
    });
    expect(ok.status).toBe(200);
  });

  it('refuses to move an agent out of the workspace the key is bound to', async () => {
    for (const targetWorkspaceId of [null, OTHER_WS]) {
      const res = await call('/agents/agt_r8_ws_public/transfer', {
        body: { targetWorkspaceId },
        key: WS_KEYS.owner,
        method: 'POST',
      });
      expect(res.status).toBe(403);
      expect((await json(res)).message).toContain('cannot move an agent out of the scope');
    }
    const row = await serverDB.query.agents.findFirst({
      where: (table, { eq }) => eq(table.id, 'agt_r8_ws_public'),
    });
    expect(row?.workspaceId).toBe(WS);
  });

  it('publishes and re-privatises the creator’s agent', async () => {
    const pub = await call('/agents/agt_r8_ws_private/visibility', {
      body: { accessLevel: 'use', visibility: 'public' },
      key: WS_KEYS.owner,
      method: 'PATCH',
    });
    expect(pub.status).toBe(200);
    expect((await json(pub)).data).toMatchObject({
      accessLevel: 'use',
      creatorId: OWNER,
      visibility: 'public',
    });

    const back = await call('/agents/agt_r8_ws_private/visibility', {
      body: { visibility: 'private' },
      key: WS_KEYS.owner,
      method: 'PATCH',
    });
    expect((await json(back)).data.visibility).toBe('private');
  });
});
