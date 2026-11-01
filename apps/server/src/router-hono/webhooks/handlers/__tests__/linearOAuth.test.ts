// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LinearConnectionModel } from '@/database/models/linear';
import { linearConnections, users, workspaceMembers, workspaces } from '@/database/schemas';

import { linearCallback } from '../linearCallback';
import { linearInstall } from '../linearInstall';

const serverDB = await getTestDB();
const userId = 'linear-oauth-user';

const mocks = vi.hoisted(() => ({
  consumeOAuthState: vi.fn(),
  exchangeLinearCode: vi.fn(),
  fetchLinearViewer: vi.fn(),
  getSession: vi.fn(),
  issueOAuthState: vi.fn(),
  revokeLinearToken: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => serverDB) }));
vi.mock('@/envs/linear', () => ({ linearEnv: { ENABLED_LINEAR: true } }));
vi.mock('@/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('@/server/services/redis', () => ({
  redisService: {
    linear: {
      consumeOAuthState: mocks.consumeOAuthState,
      issueOAuthState: mocks.issueOAuthState,
    },
  },
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: async () => ({
      decrypt: async (ciphertext: string) => ({ plaintext: ciphertext }),
      encrypt: async (plaintext: string) => plaintext,
    }),
  },
}));
vi.mock('@/server/services/linear/client', () => ({
  buildLinearAuthorizeUrl: (state: string) => `https://linear.app/oauth/authorize?state=${state}`,
  exchangeLinearCode: mocks.exchangeLinearCode,
  fetchLinearViewer: mocks.fetchLinearViewer,
  LINEAR_INSTALL_PATH: '/api/webhooks/linear/install',
  revokeLinearToken: mocks.revokeLinearToken,
}));

const app = new Hono().get('/install', linearInstall).get('/callback', linearCallback);
const request = (path: string, query: Record<string, string>) =>
  app.request(`http://localhost${path}?${new URLSearchParams(query)}`);

const location = (res: Response) => new URL(res.headers.get('location')!);

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  mocks.getSession.mockResolvedValue({ user: { id: userId } });
  mocks.issueOAuthState.mockResolvedValue('state-1');
  mocks.exchangeLinearCode.mockResolvedValue({
    accessToken: 'token',
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    refreshToken: 'refresh',
    scopes: ['read'],
  });
  mocks.fetchLinearViewer.mockResolvedValue({
    avatarUrl: 'https://avatar',
    id: 'linear-user',
    name: 'Ada',
    organization: { id: 'org-1', logoUrl: 'https://logo', name: 'Acme', urlKey: 'acme' },
  });
});

afterEach(async () => {
  await serverDB.delete(linearConnections);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
  vi.clearAllMocks();
});

describe('linearInstall', () => {
  it('issues a state for the session user and sends them to Linear', async () => {
    const res = await request('/install', { returnTo: '/settings/integrations/linear' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://linear.app/oauth/authorize?state=state-1');
    expect(mocks.issueOAuthState).toHaveBeenCalledWith({
      lobeUserId: userId,
      returnTo: '/settings/integrations/linear',
      workspaceId: null,
    });
  });

  it('bounces a signed-out visitor through sign-in', async () => {
    mocks.getSession.mockResolvedValue(null);

    const res = await request('/install', {});

    expect(location(res).pathname).toBe('/signin');
    expect(mocks.issueOAuthState).not.toHaveBeenCalled();
  });

  it('refuses a workspace the user may only view', async () => {
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'ws', primaryOwnerId: userId, slug: 'linear-oauth-ws' })
      .returning();
    await serverDB
      .insert(workspaceMembers)
      .values({ role: 'viewer', userId, workspaceId: workspace.id });

    const res = await request('/install', { workspaceId: workspace.id });

    expect(res.status).toBe(403);
  });

  it('answers 503 when no state can be stored', async () => {
    mocks.issueOAuthState.mockResolvedValue(null);

    const res = await request('/install', {});

    expect(res.status).toBe(503);
  });
});

describe('linearCallback', () => {
  it('stores the connection for the user named by the state and returns to settings', async () => {
    mocks.consumeOAuthState.mockResolvedValue({
      lobeUserId: userId,
      returnTo: '/settings/integrations/linear',
      ts: Date.now(),
    });

    const res = await request('/callback', { code: 'code-1', state: 'state-1' });

    expect(location(res).pathname).toBe('/settings/integrations/linear');
    expect(location(res).searchParams.get('installed')).toBe('ok');
    expect(mocks.exchangeLinearCode).toHaveBeenCalledWith('code-1');

    const [connection] = await LinearConnectionModel.listByScope(serverDB, { userId });
    expect(connection).toMatchObject({
      actorName: 'Ada',
      organizationId: 'org-1',
      organizationUrlKey: 'acme',
      workspaceId: null,
    });
    const decrypted = await LinearConnectionModel.findDecryptedById(serverDB, connection.id);
    expect(decrypted?.credentials).toEqual({ accessToken: 'token', refreshToken: 'refresh' });
  });

  it('never exchanges a code that arrives without our state', async () => {
    mocks.consumeOAuthState.mockResolvedValue(null);

    const res = await request('/callback', { code: 'forwarded', state: 'unknown' });

    expect(location(res).searchParams.get('error')).toBe('invalid_state');
    expect(mocks.exchangeLinearCode).not.toHaveBeenCalled();
  });

  it('reports a declined consent and a failed exchange', async () => {
    mocks.consumeOAuthState.mockResolvedValue({ lobeUserId: userId, ts: Date.now() });
    const declined = await request('/callback', { error: 'access_denied', state: 's' });
    expect(location(declined).searchParams.get('error')).toBe('access_denied');

    mocks.exchangeLinearCode.mockRejectedValue(new Error('bad code'));
    const failed = await request('/callback', { code: 'c', state: 's' });
    expect(location(failed).searchParams.get('error')).toBe('exchange_failed');
    expect(await LinearConnectionModel.listByScope(serverDB, { userId })).toEqual([]);
  });

  it('refuses a state finished by a different signed-in user', async () => {
    mocks.consumeOAuthState.mockResolvedValue({ lobeUserId: userId, ts: Date.now() });
    mocks.getSession.mockResolvedValue({ user: { id: 'someone-else' } });

    const res = await request('/callback', { code: 'victim-code', state: 'forwarded' });

    expect(location(res).searchParams.get('error')).toBe('invalid_state');
    expect(mocks.exchangeLinearCode).not.toHaveBeenCalled();
    expect(await LinearConnectionModel.listByScope(serverDB, { userId })).toEqual([]);
  });

  it('refuses a state finished without a session', async () => {
    mocks.consumeOAuthState.mockResolvedValue({ lobeUserId: userId, ts: Date.now() });
    mocks.getSession.mockResolvedValue(null);

    const res = await request('/callback', { code: 'code', state: 'state' });

    expect(location(res).searchParams.get('error')).toBe('invalid_state');
    expect(mocks.exchangeLinearCode).not.toHaveBeenCalled();
  });

  it('hands the token back when the viewer cannot be read', async () => {
    mocks.consumeOAuthState.mockResolvedValue({ lobeUserId: userId, ts: Date.now() });
    mocks.fetchLinearViewer.mockRejectedValue(new Error('graphql down'));

    const res = await request('/callback', { code: 'code', state: 'state' });

    expect(location(res).searchParams.get('error')).toBe('exchange_failed');
    expect(mocks.revokeLinearToken).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'token', refreshToken: 'refresh' }),
      new Date('2030-01-01T00:00:00.000Z'),
    );
  });

  it('returns to settings and hands the token back when the connection cannot be saved', async () => {
    mocks.consumeOAuthState.mockResolvedValue({
      lobeUserId: userId,
      returnTo: '/settings/integrations/linear',
      ts: Date.now(),
    });
    const upsert = vi
      .spyOn(LinearConnectionModel, 'upsert')
      .mockRejectedValueOnce(new Error('unique violation'));

    const res = await request('/callback', { code: 'code', state: 'state' });

    expect(location(res).pathname).toBe('/settings/integrations/linear');
    expect(location(res).searchParams.get('error')).toBe('save_failed');
    expect(mocks.revokeLinearToken).toHaveBeenCalledTimes(1);
    upsert.mockRestore();
  });
});
