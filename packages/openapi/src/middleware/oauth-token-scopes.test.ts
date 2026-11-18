// @vitest-environment node
/**
 * OAuth access tokens on the public API: the real auth, workspace and
 * permission middleware in front of the real agents routes, over PGlite.
 * Token verification is stubbed (the provider's signing is covered by the
 * oidc-provider tests); everything after it — scope narrowing, the
 * client_credentials owner and workspace binding — runs for real.
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { agents, oidcClients, users, workspaceMembers, workspaces } from '@/database/schemas';

const db = await getTestDB();

const { tokens } = vi.hoisted(() => ({ tokens: new Map<string, any>() }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => db }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async () => true;
  },
}));
const { authEnvMock } = vi.hoisted(() => ({
  authEnvMock: {
    ENABLE_OIDC: true,
    OIDC_ENABLE_API_SCOPES: true,
    OIDC_ENABLE_CLIENT_CREDENTIALS: true,
  } as Record<string, boolean>,
}));

vi.mock('@/envs/auth', () => ({ authEnv: authEnvMock }));
vi.mock('@/libs/oidc-provider/jwt', () => ({
  validateOIDCJWT: vi.fn(
    async (
      token: string,
      options?: { allowClientCredentials?: boolean; allowScopedTokens?: boolean },
    ) => {
      const info = tokens.get(token);
      if (!info) throw new Error('invalid token');
      if (info.tokenData.clientCredentials && !options?.allowClientCredentials) {
        throw new Error('client credentials not allowed');
      }
      if (!options?.allowScopedTokens) throw new Error('scoped tokens not allowed');
      return info;
    },
  ),
}));

const { userAuthMiddleware } = await import('./auth');
const { workspaceAuthMiddleware } = await import('./workspace');
const { default: AgentRoutes } = await import('../routes/agents.route');

const OWNER = 'oauth-owner';
const OTHER = 'oauth-other';
const WORKSPACE = 'ws-oauth';
const OTHER_WORKSPACE = 'ws-oauth-other';
const CLIENT = 'lcd_machine';

const userToken = (name: string, clientId: string, scope: string) =>
  tokens.set(name, {
    clientId,
    tokenData: { clientCredentials: false, scope },
    userId: OWNER,
  });

const machineToken = (name: string, scope: string | undefined, workspaceId?: string) =>
  tokens.set(name, {
    clientId: CLIENT,
    tokenData: { clientCredentials: true, scope, workspaceId },
    userId: OWNER,
  });

const request = (
  path: string,
  { body, token, workspace }: { body?: unknown; token: string; workspace?: string },
) => {
  const app = new Hono();
  app.use('*', userAuthMiddleware, workspaceAuthMiddleware);
  app.route('/agents', AgentRoutes);

  return app.request(path, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
      ...(workspace ? { 'X-Workspace-Id': workspace } : {}),
    },
    method: body === undefined ? 'GET' : 'POST',
  });
};

beforeEach(async () => {
  tokens.clear();
  await db.delete(agents);
  await db.delete(oidcClients);
  await db.delete(workspaceMembers);
  await db.delete(workspaces);
  await db.delete(users);
  await db.insert(users).values([{ id: OWNER }, { id: OTHER }]);
  await db.insert(workspaces).values([
    { id: WORKSPACE, name: 'Ops', primaryOwnerId: OWNER, slug: 'ops-oauth' },
    { id: OTHER_WORKSPACE, name: 'Other', primaryOwnerId: OTHER, slug: 'other-oauth' },
  ]);
  await db.insert(workspaceMembers).values([
    { role: 'owner', userId: OWNER, workspaceId: WORKSPACE },
    { role: 'owner', userId: OTHER, workspaceId: OTHER_WORKSPACE },
  ]);
  await db.insert(oidcClients).values({
    enabled: true,
    grants: ['client_credentials'],
    id: CLIENT,
    name: 'Nightly Sync',
    redirectUris: [],
    responseTypes: [],
    scopes: ['agent:read'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    userId: OWNER,
    workspaceId: WORKSPACE,
  });
});

describe('user OAuth tokens', () => {
  it('keeps a first-party sign-in that asked for no API scope unrestricted', async () => {
    userToken('desktop', 'lobehub-desktop', 'openid profile offline_access');

    expect((await request('/agents', { token: 'desktop' })).status).toBe(200);
    expect((await request('/agents', { body: { title: 'Writer' }, token: 'desktop' })).status).toBe(
      200,
    );
  });

  it('narrows a token that carries API scopes to them', async () => {
    userToken('reader', 'lca_app', 'openid agent:read');

    expect((await request('/agents', { token: 'reader' })).status).toBe(200);

    const write = await request('/agents', { body: { title: 'Writer' }, token: 'reader' });
    expect(write.status).toBe(403);
    expect(await write.text()).toContain(
      'this access token is missing required scope(s): agent:write',
    );
  });

  it('gives a dynamically registered client nothing it was not consented', async () => {
    userToken('partner', 'lcd_partner', 'openid profile');

    expect((await request('/agents', { token: 'partner' })).status).toBe(403);
  });

  it('lets a user token pick any workspace the user belongs to, and no other', async () => {
    userToken('reader', 'lca_app', 'agent:read');

    expect((await request('/agents', { token: 'reader', workspace: WORKSPACE })).status).toBe(200);
    expect((await request('/agents', { token: 'reader', workspace: OTHER_WORKSPACE })).status).toBe(
      403,
    );
  });
});

describe('client_credentials tokens', () => {
  it('acts as the owner inside the client workspace with the token scopes', async () => {
    machineToken('machine', 'agent:read', WORKSPACE);

    expect((await request('/agents', { token: 'machine' })).status).toBe(200);
    expect((await request('/agents', { token: 'machine', workspace: WORKSPACE })).status).toBe(200);
    expect((await request('/agents', { body: { title: 'Writer' }, token: 'machine' })).status).toBe(
      403,
    );
  });

  it('cannot reach another workspace', async () => {
    machineToken('machine', 'agent:read', WORKSPACE);

    const res = await request('/agents', { token: 'machine', workspace: OTHER_WORKSPACE });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Workspace OAuth app cannot access a different workspace');
  });

  it('is narrowed to nothing when it carries no scope', async () => {
    machineToken('bare', undefined, WORKSPACE);

    expect((await request('/agents', { token: 'bare' })).status).toBe(403);
  });

  it('stops working once its client is disabled or moved', async () => {
    machineToken('machine', 'agent:read', WORKSPACE);

    await db.update(oidcClients).set({ enabled: false });
    expect((await request('/agents', { token: 'machine' })).status).toBe(401);

    await db.update(oidcClients).set({ enabled: true, workspaceId: null });
    expect((await request('/agents', { token: 'machine' })).status).toBe(401);
  });

  it('is refused outright once the grant is switched off', async () => {
    machineToken('machine', 'agent:read', WORKSPACE);
    authEnvMock.OIDC_ENABLE_CLIENT_CREDENTIALS = false;

    try {
      expect((await request('/agents', { token: 'machine' })).status).toBe(401);
    } finally {
      authEnvMock.OIDC_ENABLE_CLIENT_CREDENTIALS = true;
    }
  });

  it('rejects an unauthenticated request', async () => {
    expect((await request('/agents', { token: 'unknown' })).status).toBe(401);
  });
});
