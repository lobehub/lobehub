// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/workspaces` over real HTTP: the real routes behind the same auth +
 * workspace middlewares `app.ts` mounts, real scope gates and real
 * path-workspace binding, on a PGlite database with real `api_keys` rows.
 *
 * The workspace, member and audit-log rules live in the cloud overlay of
 * `@/business/server/lambda-routers/*`, which this repo does not contain, so
 * those three routers are replaced by fakes that record the context they were
 * called with. The tests therefore prove what this layer owns — isolation,
 * scopes, validation, shaping and error mapping — and the self-hosted `501`.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({
  business: true,
  calls: [] as { ctx: { userId: string; workspaceId?: string }; input?: unknown; op: string }[],
  serverDB: undefined as unknown,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  get ENABLE_BUSINESS_FEATURES() {
    return holder.business;
  },
}));

const OWNER = 'r9-ws-owner';
const MEMBER = 'r9-ws-member';
const OUTSIDER = 'r9-ws-outsider';
const WORKSPACE = 'r9-ws';
const OTHER_WORKSPACE = 'r9-ws-other';
const NOW = new Date('2026-03-01T00:00:00.000Z');

const fakeCaller = (impl: (ctx: any) => Record<string, (input?: any) => unknown>) =>
  ({
    createCaller: (ctx: any) =>
      new Proxy(impl(ctx), {
        get: (target, op: string) => async (input?: unknown) => {
          holder.calls.push({ ctx, input, op });
          return target[op](input);
        },
      }),
  }) as any;

const requireAdmin = (ctx: { userId: string }) => {
  if (ctx.userId !== OWNER) throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' });
};

vi.mock('@/business/server/lambda-routers/workspace', () => ({
  workspaceRouter: fakeCaller((ctx) => ({
    list: () => [
      {
        createdAt: NOW,
        description: null,
        id: WORKSPACE,
        name: 'R9',
        plan: 'business',
        primaryOwnerId: OWNER,
        role: ctx.userId === OWNER ? 'owner' : 'member',
        slug: 'r9',
        updatedAt: NOW,
      },
      {
        createdAt: NOW,
        id: OTHER_WORKSPACE,
        name: 'Other',
        primaryOwnerId: OWNER,
        role: 'admin',
        slug: 'r9-other',
        updatedAt: NOW,
      },
    ],
    update: () => requireAdmin(ctx),
  })),
}));

vi.mock('@/business/server/lambda-routers/workspaceMember', () => ({
  workspaceMemberRouter: fakeCaller((ctx) => ({
    invite: (input: { email?: string; role: string }) => {
      requireAdmin(ctx);
      if (input.email === 'dup@r9.test') {
        throw new TRPCError({ code: 'CONFLICT', message: `ALREADY_INVITED:${input.email}` });
      }
      return {
        createdAt: NOW,
        email: input.email ?? null,
        expiresAt: null,
        id: 'inv_1',
        inviterId: ctx.userId,
        reusable: false,
        role: input.role,
        status: 'pending',
        token: 'tok_1',
        workspaceId: ctx.workspaceId,
      };
    },
    list: () => [
      { joinedAt: NOW, role: 'owner', title: 'Lead', user: null, userId: OWNER },
      {
        joinedAt: NOW,
        role: 'member',
        user: { avatar: null, email: 'm@r9.test', fullName: 'Member', username: 'm' },
        userId: MEMBER,
      },
    ],
    listInvitations: () => [],
    remove: () => requireAdmin(ctx),
    revokeInvitation: (input: { id: string }) => {
      if (input.id === 'inv_cloud_only') {
        throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'cloud-only' });
      }
      requireAdmin(ctx);
    },
    updateRole: () => requireAdmin(ctx),
  })),
}));

vi.mock('@/business/server/lambda-routers/workspaceAuditLog', () => ({
  workspaceAuditLogRouter: fakeCaller(() => ({
    list: (input: { cursor?: string }) => ({
      items: [
        {
          action: 'member.invited',
          createdAt: NOW,
          id: 'log_1',
          ipAddress: null,
          metadata: { role: 'member' },
          resourceId: 'inv_1',
          resourceType: 'invitation',
          userId: OWNER,
          workspaceId: WORKSPACE,
        },
      ],
      nextCursor: input.cursor ? null : '2026-02-01T00:00:00.000Z',
    }),
  })),
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { apiKeys, users, workspaceMembers, workspaces } = await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const WorkspaceRoutes = (await import('./workspaces.route')).default;

const serverDB = await getTestDB();
holder.serverDB = serverDB;

const app = new Hono().basePath('/api/v1');
app.onError((error, c) =>
  error instanceof HTTPException
    ? renderApiError(c, errorInitFromException(error))
    : renderApiError(c, { message: error.message, status: 500 }),
);
app.use('*', userAuthMiddleware);
app.use('*', workspaceAuthMiddleware);
app.route('/workspaces', WorkspaceRoutes);

/** `sk-lh-` + 16 lowercase alphanumerics — the format the auth middleware checks. */
const KEYS = {
  member: 'sk-lh-r9wsmemberfull01',
  outsider: 'sk-lh-r9wsoutsider0001',
  ownerFull: 'sk-lh-r9wsownerfull001',
  ownerPersonal: 'sk-lh-r9wsownerperson1',
  ownerRead: 'sk-lh-r9wsownerread001',
  ownerWrite: 'sk-lh-r9wsownerwrite01',
} as const;

const call = (
  path: string,
  init: { body?: unknown; key?: string; method?: string; workspaceId?: string } = {},
) =>
  app.request(`/api/v1${path}`, {
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
      ...(init.workspaceId ? { 'x-workspace-id': init.workspaceId } : {}),
      'content-type': 'application/json',
    },
    method: init.method ?? 'GET',
  });

const json = async (res: Response) => (await res.json()) as any;

beforeEach(async () => {
  holder.business = true;
  holder.calls = [];
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: MEMBER }, { id: OUTSIDER }]);
  await serverDB.insert(workspaces).values([
    { id: WORKSPACE, name: 'R9', primaryOwnerId: OWNER, slug: 'r9' },
    { id: OTHER_WORKSPACE, name: 'Other', primaryOwnerId: OWNER, slug: 'r9-other' },
  ]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: OWNER, workspaceId: WORKSPACE },
    { role: 'admin', userId: OWNER, workspaceId: OTHER_WORKSPACE },
    { role: 'member', userId: MEMBER, workspaceId: WORKSPACE },
  ]);

  const key = (value: string, userId: string, scopes: string[], workspaceId?: string) => ({
    key: value,
    keyHash: hashApiKey(value),
    name: value,
    scopes,
    userId,
    workspaceId: workspaceId ?? null,
  });
  await serverDB.insert(apiKeys).values([
    key(KEYS.ownerFull, OWNER, ['*'], WORKSPACE),
    key(KEYS.ownerRead, OWNER, ['workspace:read'], WORKSPACE),
    key(KEYS.ownerWrite, OWNER, ['workspace:write'], WORKSPACE),
    key(KEYS.ownerPersonal, OWNER, ['workspace:read']),
    key(KEYS.member, MEMBER, ['*'], WORKSPACE),
    // A binding that outlived the membership.
    key(KEYS.outsider, OUTSIDER, ['*'], WORKSPACE),
  ]);
});

describe('self-hosted build', () => {
  it.each([
    ['GET', '/workspaces'],
    ['GET', `/workspaces/${WORKSPACE}`],
    ['GET', `/workspaces/${WORKSPACE}/members`],
    ['GET', `/workspaces/${WORKSPACE}/audit-logs`],
    ['DELETE', `/workspaces/${WORKSPACE}/members/${MEMBER}`],
  ])('answers %s %s with 501 feature_unavailable', async (method, path) => {
    holder.business = false;

    const res = await call(path, { key: KEYS.ownerFull, method });

    expect(res.status).toBe(501);
    expect(await json(res)).toMatchObject({
      code: 'feature_unavailable',
      error: 'Team workspace management is not available on this deployment',
      message: 'Team workspace management is not available on this deployment',
      success: false,
    });
    expect(holder.calls).toEqual([]);
  });
});

describe('authentication, scopes and workspace isolation', () => {
  it('answers 401 without credentials', async () => {
    expect((await call('/workspaces')).status).toBe(401);
  });

  it('lists every membership for a personal key, only the bound one for a workspace key', async () => {
    const personal = await json(await call('/workspaces', { key: KEYS.ownerPersonal }));
    expect(personal.data.items.map((w: any) => w.id)).toEqual([WORKSPACE, OTHER_WORKSPACE]);
    expect(personal.data).toMatchObject({ hasMore: false, total: 2 });

    const bound = await json(await call('/workspaces', { key: KEYS.ownerRead }));
    expect(bound.data.items).toEqual([
      {
        avatar: null,
        createdAt: NOW.toISOString(),
        description: null,
        id: WORKSPACE,
        name: 'R9',
        plan: 'business',
        primaryOwnerId: OWNER,
        role: 'owner',
        slug: 'r9',
        updatedAt: NOW.toISOString(),
      },
    ]);
  });

  it('refuses a personal key on a workspace path', async () => {
    const res = await call(`/workspaces/${WORKSPACE}/members`, { key: KEYS.ownerPersonal });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
  });

  it('refuses a workspace key addressing another workspace in the path', async () => {
    const res = await call(`/workspaces/${OTHER_WORKSPACE}/members`, { key: KEYS.ownerFull });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
    expect(holder.calls).toEqual([]);
  });

  it('refuses a header that disagrees with the path', async () => {
    const res = await call(`/workspaces/${OTHER_WORKSPACE}`, {
      key: KEYS.ownerFull,
      workspaceId: WORKSPACE,
    });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
  });

  it('refuses a caller who is no longer a member', async () => {
    const res = await call(`/workspaces/${WORKSPACE}/members`, { key: KEYS.outsider });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
  });

  it('needs workspace:write to update the workspace', async () => {
    const res = await call(`/workspaces/${WORKSPACE}`, {
      body: { name: 'Renamed' },
      key: KEYS.ownerRead,
      method: 'PATCH',
    });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it.each([
    // Invitation tokens are as good as a fresh invitation.
    ['GET', `/workspaces/${WORKSPACE}/invitations`, undefined],
    ['PATCH', `/workspaces/${WORKSPACE}/members/${MEMBER}`, { role: 'admin' }],
    ['DELETE', `/workspaces/${WORKSPACE}/members/${MEMBER}`, undefined],
    ['POST', `/workspaces/${WORKSPACE}/invitations`, { email: 'new@r9.test' }],
    ['DELETE', `/workspaces/${WORKSPACE}/invitations/inv_1`, undefined],
  ])('keeps %s %s away from a restricted key', async (method, path, body) => {
    const res = await call(path, { body, key: KEYS.ownerWrite, method });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
    expect(holder.calls).toEqual([]);
  });
});

describe('request validation', () => {
  it.each([
    ['PATCH', `/workspaces/${WORKSPACE}`, {}],
    ['PATCH', `/workspaces/${WORKSPACE}`, { slug: 'Not A Slug!' }],
    ['PATCH', `/workspaces/${WORKSPACE}/members/${MEMBER}`, { role: 'owner' }],
    ['POST', `/workspaces/${WORKSPACE}/invitations`, { email: 'not-an-email' }],
    ['POST', `/workspaces/${WORKSPACE}/invitations`, { role: 'superuser' }],
  ])('rejects %s %s with %j', async (method, path, body) => {
    const res = await call(path, { body, key: KEYS.ownerFull, method });

    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('validation_error');
  });

  it.each([
    ['an out-of-range page size', 'limit=500'],
    ['a cursor that is not an instant', 'cursor=abc'],
  ])('rejects an audit-log query with %s', async (_label, query) => {
    const res = await call(`/workspaces/${WORKSPACE}/audit-logs?${query}`, {
      key: KEYS.ownerRead,
    });

    expect(res.status).toBe(400);
    expect(holder.calls).toEqual([]);
  });
});

describe('workspace, members and invitations', () => {
  it('gets and updates the workspace in the path context', async () => {
    const got = await json(await call(`/workspaces/${WORKSPACE}`, { key: KEYS.ownerRead }));
    expect(got.data).toMatchObject({ id: WORKSPACE, role: 'owner' });

    const updated = await call(`/workspaces/${WORKSPACE}`, {
      body: { name: 'Renamed' },
      key: KEYS.ownerWrite,
      method: 'PATCH',
    });
    expect(updated.status).toBe(200);
    expect(holder.calls.find((c) => c.op === 'update')).toEqual({
      ctx: { userId: OWNER, workspaceId: WORKSPACE },
      input: { name: 'Renamed' },
      op: 'update',
    });
  });

  it('pages members and shapes their profiles', async () => {
    const first = await json(
      await call(`/workspaces/${WORKSPACE}/members?limit=1`, { key: KEYS.ownerRead }),
    );
    expect(first.data).toMatchObject({ hasMore: true, total: 2 });
    expect(first.data.items).toEqual([
      {
        joinedAt: NOW.toISOString(),
        responsibilities: null,
        role: 'owner',
        title: 'Lead',
        user: null,
        userId: OWNER,
      },
    ]);

    const second = await json(
      await call(`/workspaces/${WORKSPACE}/members?limit=1&cursor=${first.data.nextCursor}`, {
        key: KEYS.ownerRead,
      }),
    );
    expect(second.data).toMatchObject({ hasMore: false, nextCursor: null });
    expect(second.data.items[0].user).toEqual({
      avatar: null,
      email: 'm@r9.test',
      fullName: 'Member',
      id: MEMBER,
      username: 'm',
    });
  });

  it("changes a member's role and removes them", async () => {
    const updated = await call(`/workspaces/${WORKSPACE}/members/${MEMBER}`, {
      body: { role: 'admin' },
      key: KEYS.ownerFull,
      method: 'PATCH',
    });
    expect(updated.status).toBe(200);
    expect(holder.calls.find((c) => c.op === 'updateRole')).toMatchObject({
      ctx: { userId: OWNER, workspaceId: WORKSPACE },
      input: { role: 'admin', userId: MEMBER },
    });

    const removed = await call(`/workspaces/${WORKSPACE}/members/${MEMBER}`, {
      key: KEYS.ownerFull,
      method: 'DELETE',
    });
    expect((await json(removed)).data).toEqual({ deleted: true, id: MEMBER });
  });

  it('maps the cloud refusals onto HTTP', async () => {
    const forbidden = await call(`/workspaces/${WORKSPACE}/members/${OWNER}`, {
      body: { role: 'viewer' },
      key: KEYS.member,
      method: 'PATCH',
    });
    expect(forbidden.status).toBe(403);

    const conflict = await call(`/workspaces/${WORKSPACE}/invitations`, {
      body: { email: 'dup@r9.test' },
      key: KEYS.ownerFull,
      method: 'POST',
    });
    expect(conflict.status).toBe(409);

    const stub = await call(`/workspaces/${WORKSPACE}/invitations/inv_cloud_only`, {
      key: KEYS.ownerFull,
      method: 'DELETE',
    });
    expect(stub.status).toBe(501);
    expect((await json(stub)).code).toBe('feature_unavailable');
  });

  it('creates and revokes an invitation', async () => {
    const created = await call(`/workspaces/${WORKSPACE}/invitations`, {
      body: { email: 'new@r9.test' },
      key: KEYS.ownerFull,
      method: 'POST',
    });
    expect(created.status).toBe(201);
    expect((await json(created)).data).toEqual({
      createdAt: NOW.toISOString(),
      email: 'new@r9.test',
      expiresAt: null,
      id: 'inv_1',
      inviterId: OWNER,
      reusable: false,
      role: 'member',
      status: 'pending',
      token: 'tok_1',
    });

    const revoked = await call(`/workspaces/${WORKSPACE}/invitations/inv_1`, {
      key: KEYS.ownerFull,
      method: 'DELETE',
    });
    expect((await json(revoked)).data).toEqual({ deleted: true, id: 'inv_1' });
  });
});

describe('audit log', () => {
  it('passes the cursor and filters through and reports the next page', async () => {
    const first = await json(
      await call(`/workspaces/${WORKSPACE}/audit-logs?limit=1&action=member.invited`, {
        key: KEYS.ownerRead,
      }),
    );
    expect(first.data).toEqual({
      hasMore: true,
      items: [
        {
          action: 'member.invited',
          createdAt: NOW.toISOString(),
          id: 'log_1',
          ipAddress: null,
          metadata: { role: 'member' },
          resourceId: 'inv_1',
          resourceType: 'invitation',
          userId: OWNER,
        },
      ],
      nextCursor: '2026-02-01T00:00:00.000Z',
    });
    expect(holder.calls.at(-1)).toMatchObject({
      ctx: { workspaceId: WORKSPACE },
      input: { action: 'member.invited', limit: 1 },
      op: 'list',
    });

    const second = await json(
      await call(`/workspaces/${WORKSPACE}/audit-logs?cursor=${first.data.nextCursor}`, {
        key: KEYS.ownerRead,
      }),
    );
    expect(second.data).toMatchObject({ hasMore: false, nextCursor: null });
    expect(holder.calls.at(-1)?.input).toMatchObject({
      cursor: '2026-02-01T00:00:00.000Z',
      limit: 20,
    });
  });
});
