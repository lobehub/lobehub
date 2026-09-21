// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScmIdentityModel, ScmInstallationModel } from '@/database/models/scm';
import { scmWebhookDeliveries, users } from '@/database/schemas';

import { githubSetup } from '../githubSetup';

const serverDB = await getTestDB();
const userId = 'scm-setup-user';

const mocks = vi.hoisted(() => ({
  consumeState: vi.fn(),
  exchangeCode: vi.fn(),
  fetchInstallation: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => serverDB) }));
vi.mock('@/envs/scm', () => ({ scmEnv: { ENABLED_GITHUB_APP: true } }));
vi.mock('@/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => undefined },
}));
vi.mock('@/server/services/scm/oauth/stateStore', () => ({
  consumeScmInstallState: mocks.consumeState,
}));
vi.mock('@/server/services/scm/github/app', () => ({
  exchangeGitHubUserCode: mocks.exchangeCode,
  fetchGitHubInstallation: mocks.fetchInstallation,
}));

const app = new Hono().get('/setup', githubSetup);
const setup = (query: Record<string, string>) =>
  app.request(`http://localhost/setup?${new URLSearchParams(query)}`);

const snapshot = {
  accountExternalId: '1',
  accountLogin: 'arvinxx',
  accountType: 'user' as const,
  installationId: '777',
  provider: 'github' as const,
  repositorySelection: 'selected' as const,
  repositories: [{ externalId: '9', fullName: 'arvinxx/sandbox' }],
};

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: 'scm-setup-other' }]);
  mocks.consumeState.mockResolvedValue(null);
  mocks.getSession.mockResolvedValue(null);
  mocks.fetchInstallation.mockResolvedValue(snapshot);
  mocks.exchangeCode.mockResolvedValue({
    accessToken: 'ghu_token',
    user: { externalId: '42', login: 'arvinxx' },
  });
});

afterEach(async () => {
  await serverDB.delete(scmWebhookDeliveries);
  await serverDB.delete(users);
  vi.clearAllMocks();
});

describe('githubSetup', () => {
  it('bounces to sign-in when neither state nor session identifies a user', async () => {
    const res = await setup({ code: 'c', installation_id: '777' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/signin?callbackUrl=');
  });

  it('binds the installation and identity on the code leg using the state user', async () => {
    mocks.consumeState.mockResolvedValue({ lobeUserId: userId, ts: 1 });

    const res = await setup({ code: 'c', installation_id: '777', state: 's' });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/settings/integrations/github');
    expect(Object.fromEntries(location.searchParams)).toEqual({
      account: 'arvinxx',
      installed: 'ok',
    });

    const installation = await ScmInstallationModel.findByProviderInstallationId(
      serverDB,
      'github',
      '777',
    );
    expect(installation).toMatchObject({
      installedByExternalLogin: 'arvinxx',
      repositories: snapshot.repositories,
      userId,
      workspaceId: null,
    });
    expect(await ScmIdentityModel.findByExternalUser(serverDB, 'github', '42')).toMatchObject({
      externalLogin: 'arvinxx',
      userId,
    });
  });

  it('never binds or links without our state: a known own installation is refreshed, anything else is handed over as pending', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: userId } });

    // Unknown installation, no state: no bind, no code exchange, confirm in the app.
    const first = await setup({
      code: 'attacker-code',
      installation_id: '777',
      setup_action: 'install',
    });
    const firstLocation = new URL(first.headers.get('location')!);
    expect(Object.fromEntries(firstLocation.searchParams)).toEqual({
      account: 'arvinxx',
      pending: '777',
    });
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
    expect(
      await ScmInstallationModel.findByProviderInstallationId(serverDB, 'github', '777'),
    ).toBeNull();

    // Someone else's installation: also pending, never refreshed into their row.
    await ScmInstallationModel.bind(serverDB, { ...snapshot, userId: 'scm-setup-other' });
    const theirs = await setup({ installation_id: '777', setup_action: 'update' });
    expect(new URL(theirs.headers.get('location')!).searchParams.get('pending')).toBe('777');
    expect(
      (await ScmInstallationModel.findByProviderInstallationId(serverDB, 'github', '777'))
        ?.repositories,
    ).toEqual(snapshot.repositories);

    // The session user's own installation is refreshed from the API.
    await ScmInstallationModel.bind(serverDB, { ...snapshot, userId });
    mocks.fetchInstallation.mockResolvedValue({ ...snapshot, repositories: [] });
    const second = await setup({ installation_id: '777', setup_action: 'update' });
    expect(new URL(second.headers.get('location')!).searchParams.get('installed')).toBe('updated');
    const refreshed = await ScmInstallationModel.findByProviderInstallationId(
      serverDB,
      'github',
      '777',
    );
    expect(refreshed?.repositories).toEqual([]);
  });

  it('binds without an identity when the state is valid but GitHub sent no code', async () => {
    mocks.consumeState.mockResolvedValue({ lobeUserId: userId, ts: 1 });

    const res = await setup({ installation_id: '777', setup_action: 'install', state: 's' });
    expect(new URL(res.headers.get('location')!).searchParams.get('installed')).toBe('ok');
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
    expect(
      await ScmInstallationModel.findByProviderInstallationId(serverDB, 'github', '777'),
    ).toMatchObject({ installedByExternalLogin: null, userId });
  });

  it('only follows same-origin return destinations from the state', async () => {
    mocks.consumeState.mockResolvedValue({
      lobeUserId: userId,
      returnTo: 'https://evil.example/phish',
      ts: 1,
    });

    const res = await setup({ code: 'c', installation_id: '777', state: 's' });
    const location = new URL(res.headers.get('location')!);
    expect(location.origin).toBe('http://localhost');
    expect(location.pathname).toBe('/settings/integrations/github');
  });

  it('reports a failed code exchange instead of binding', async () => {
    mocks.consumeState.mockResolvedValue({ lobeUserId: userId, ts: 1 });
    mocks.exchangeCode.mockRejectedValue(new Error('bad_verification_code'));

    const res = await setup({ code: 'expired', installation_id: '777', state: 's' });
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('exchange_failed');
    expect(
      await ScmInstallationModel.findByProviderInstallationId(serverDB, 'github', '777'),
    ).toBeNull();
  });
});
