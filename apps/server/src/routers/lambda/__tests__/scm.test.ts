// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ScmChangeRequestModel,
  ScmIdentityModel,
  ScmInstallationModel,
} from '@/database/models/scm';
import { scmWebhookDeliveries, users, workspaceMembers, workspaces } from '@/database/schemas';

import { scmRouter } from '../scm';

const serverDB = await getTestDB();
const userId = 'scm-router-user';
const otherUserId = 'scm-router-user-2';

vi.mock('@/envs/scm', () => ({
  scmEnv: { ENABLED_GITHUB_APP: true, GITHUB_APP_SLUG: 'lobehub-dev' },
}));

const mocks = vi.hoisted(() => ({ consumeClaim: vi.fn(), fetchInstallation: vi.fn() }));
vi.mock('@/server/services/scm/oauth/stateStore', () => ({
  consumeScmInstallClaim: mocks.consumeClaim,
}));
vi.mock('@/server/services/scm/github/app', () => ({
  fetchGitHubInstallation: mocks.fetchInstallation,
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return { wsCompatProcedure: mod.trpc.procedure };
});

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) => opts.next({ ctx: { ...opts.ctx, serverDB } }),
}));

const caller = (ctx: { userId: string; workspaceId?: string | null }) =>
  scmRouter.createCaller({ ...ctx, serverDB } as any);

const bind = (installationId: string, scope: { userId: string; workspaceId?: string | null }) =>
  ScmInstallationModel.bind(serverDB, {
    accountExternalId: installationId,
    accountLogin: `acct-${installationId}`,
    accountType: 'user',
    installationId,
    provider: 'github',
    repositorySelection: 'all',
    ...scope,
  });

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(scmWebhookDeliveries);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

describe('scmRouter', () => {
  it('reports the connect configuration', async () => {
    expect(await caller({ userId }).getConfig()).toEqual({
      github: {
        appSlug: 'lobehub-dev',
        enabled: true,
        installPath: '/api/webhooks/github/install',
      },
    });
  });

  it('returns the identity without credentials, or null', async () => {
    expect(await caller({ userId }).getIdentity({ provider: 'github' })).toBeNull();

    await ScmIdentityModel.upsert(serverDB, {
      credentials: { accessToken: 'secret' },
      externalLogin: 'arvinxx',
      externalUserId: '42',
      metadata: { avatarUrl: 'https://a/b.png' },
      provider: 'github',
      userId,
    });
    const identity = await caller({ userId }).getIdentity({ provider: 'github' });
    expect(identity).toEqual({
      avatarUrl: 'https://a/b.png',
      externalLogin: 'arvinxx',
      externalUserId: '42',
      provider: 'github',
    });
    expect(JSON.stringify(identity)).not.toContain('secret');
  });

  it('lists only the installations and change requests in the caller scope', async () => {
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'ws', primaryOwnerId: userId, slug: 'scm-ws' })
      .returning();

    const personal = await bind('1', { userId });
    const theirs = await bind('2', { userId: otherUserId });
    const shared = await bind('3', { userId, workspaceId: workspace.id });

    const base = { provider: 'github' as const, state: 'open' as const };
    await ScmChangeRequestModel.upsert(serverDB, {
      ...base,
      links: { installationId: personal.id },
      number: 1,
      repoFullName: 'a/personal',
      url: 'https://github.com/a/personal/pull/1',
      userId,
    });
    await ScmChangeRequestModel.upsert(serverDB, {
      ...base,
      links: { installationId: theirs.id },
      number: 2,
      repoFullName: 'b/theirs',
      url: 'https://github.com/b/theirs/pull/2',
      userId: otherUserId,
    });
    await ScmChangeRequestModel.upsert(serverDB, {
      ...base,
      links: { installationId: shared.id },
      number: 3,
      repoFullName: 'c/shared',
      url: 'https://github.com/c/shared/pull/3',
      userId,
      workspaceId: workspace.id,
    });

    const mine = caller({ userId });
    expect((await mine.listInstallations()).map((i) => i.id)).toEqual([personal.id]);
    expect((await mine.listChangeRequests()).map((r) => r.repoFullName)).toEqual(['a/personal']);

    const ws = caller({ userId, workspaceId: workspace.id });
    expect((await ws.listInstallations()).map((i) => i.id)).toEqual([shared.id]);
    expect((await ws.listChangeRequests({ limit: 10 })).map((r) => r.repoFullName)).toEqual([
      'c/shared',
    ]);
  });

  it('refuses a claim that is expired or was minted for someone else', async () => {
    mocks.fetchInstallation.mockResolvedValue({
      accountExternalId: '9',
      accountLogin: 'arvinxx',
      accountType: 'user',
      installationId: '900',
      provider: 'github',
      repositorySelection: 'all',
    });

    // Expired or replayed: the store hands back nothing.
    mocks.consumeClaim.mockResolvedValueOnce(null);
    await expect(caller({ userId }).connectInstallation({ claim: 'gone' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    // Minted for another user: knowing the token is not enough.
    mocks.consumeClaim.mockResolvedValueOnce({
      installationId: '900',
      lobeUserId: otherUserId,
      provider: 'github',
      ts: 1,
    });
    await expect(caller({ userId }).connectInstallation({ claim: 'theirs' })).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );

    // Neither attempt reached GitHub or the database.
    expect(mocks.fetchInstallation).not.toHaveBeenCalled();
    expect(
      await ScmInstallationModel.findByProviderInstallationId(serverDB, 'github', '900'),
    ).toBeNull();
  });

  it('connects a pending installation into the caller scope, but never one bound elsewhere', async () => {
    mocks.consumeClaim.mockResolvedValue({
      installationId: '900',
      lobeUserId: userId,
      provider: 'github',
      ts: 1,
    });
    mocks.fetchInstallation.mockResolvedValue({
      accountExternalId: '9',
      accountLogin: 'arvinxx',
      accountType: 'user',
      installationId: '900',
      provider: 'github',
      repositorySelection: 'all',
    });

    const mine = caller({ userId });
    const bound = await mine.connectInstallation({ claim: 'c1' });
    expect(bound).toMatchObject({ accountLogin: 'arvinxx', userId, workspaceId: null });
    expect(mocks.fetchInstallation).toHaveBeenCalledWith('900');

    // Re-confirming in the same scope is a refresh, not an error.
    await expect(mine.connectInstallation({ claim: 'c2' })).resolves.toMatchObject({
      id: bound.id,
    });

    // Another user holding a claim of their own cannot pull it into their account.
    mocks.consumeClaim.mockResolvedValueOnce({
      installationId: '900',
      lobeUserId: otherUserId,
      provider: 'github',
      ts: 1,
    });
    await expect(
      caller({ userId: otherUserId }).connectInstallation({ claim: 'c3' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // An installation GitHub does not know binds nothing.
    mocks.consumeClaim.mockResolvedValueOnce({
      installationId: '404',
      lobeUserId: userId,
      provider: 'github',
      ts: 1,
    });
    mocks.fetchInstallation.mockRejectedValueOnce(new Error('404'));
    await expect(mine.connectInstallation({ claim: 'c4' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(
      await ScmInstallationModel.findByProviderInstallationId(serverDB, 'github', '404'),
    ).toBeNull();
  });

  it('requires the member role to connect into a workspace', async () => {
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'ws', primaryOwnerId: userId, slug: 'scm-ws-connect' })
      .returning();
    await serverDB
      .insert(workspaceMembers)
      .values({ role: 'viewer', userId: otherUserId, workspaceId: workspace.id });
    mocks.fetchInstallation.mockResolvedValue({
      accountExternalId: '10',
      accountLogin: 'org',
      accountType: 'organization',
      installationId: '901',
      provider: 'github',
      repositorySelection: 'all',
    });

    mocks.consumeClaim.mockResolvedValue({
      installationId: '901',
      lobeUserId: otherUserId,
      provider: 'github',
      ts: 1,
    });
    await expect(
      caller({ userId: otherUserId, workspaceId: workspace.id }).connectInstallation({
        claim: 'c5',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await serverDB
      .insert(workspaceMembers)
      .values({ role: 'member', userId, workspaceId: workspace.id });
    mocks.consumeClaim.mockResolvedValue({
      installationId: '901',
      lobeUserId: userId,
      provider: 'github',
      ts: 1,
    });
    await expect(
      caller({ userId, workspaceId: workspace.id }).connectInstallation({ claim: 'c6' }),
    ).resolves.toMatchObject({ userId, workspaceId: workspace.id });
  });
});
