// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ScmChangeRequestModel,
  ScmCredentialGrantModel,
  ScmIdentityModel,
  ScmInstallationModel,
} from '@/database/models/scm';
import {
  scmCredentialGrants,
  scmWebhookDeliveries,
  topics,
  users,
  workspaceAuditLogs,
  workspaceMembers,
  workspaces,
} from '@/database/schemas';

import { scmRouter } from '../scm';

const serverDB = await getTestDB();
const userId = 'scm-router-user';
const otherUserId = 'scm-router-user-2';

const scmEnv = vi.hoisted(() => ({
  ENABLED_GITHUB_APP: true,
  ENABLED_GITHUB_APP_OAUTH: true,
  GITHUB_APP_SLUG: 'lobehub-dev',
}));
vi.mock('@/envs/scm', () => ({ scmEnv }));

const mocks = vi.hoisted(() => ({
  consumeClaim: vi.fn(),
  fetchInstallation: vi.fn(),
  listRepositories: vi.fn(),
  revokeToken: vi.fn(),
}));
vi.mock('@/server/services/scm/oauth/stateStore', () => ({
  consumeScmInstallClaim: mocks.consumeClaim,
}));
vi.mock('@/server/services/scm/github/app', () => ({
  fetchGitHubInstallation: mocks.fetchInstallation,
  listGitHubInstallationRepositoryDetails: mocks.listRepositories,
  revokeGitHubUserToken: mocks.revokeToken,
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => undefined },
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return {
    requireWorkspaceRoleWhenScoped: () => mod.trpc.middleware((opts: any) => opts.next()),
    wsCompatProcedure: mod.trpc.procedure,
  };
});

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) => opts.next({ ctx: { ...opts.ctx, serverDB } }),
}));

const caller = (ctx: { userId: string; workspaceId?: string | null; workspaceRole?: string }) =>
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
  await serverDB.delete(scmCredentialGrants);
  await serverDB.delete(scmWebhookDeliveries);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

describe('scmRouter', () => {
  it('reports the connect configuration', async () => {
    expect(await caller({ userId }).getConfig()).toEqual({
      github: {
        appSlug: 'lobehub-dev',
        authorizeEnabled: true,
        authorizePath: '/api/webhooks/github/authorize',
        enabled: true,
        installPath: '/api/webhooks/github/install',
      },
    });
  });

  it("disconnects the caller's own GitHub identity and revokes its token", async () => {
    await ScmIdentityModel.upsert(serverDB, {
      credentials: { accessToken: 'ghu_mine' },
      externalLogin: 'mine',
      externalUserId: 'ext-mine',
      provider: 'github',
      userId,
    });
    await ScmIdentityModel.upsert(serverDB, {
      externalLogin: 'theirs',
      externalUserId: 'ext-theirs',
      provider: 'github',
      userId: otherUserId,
    });

    await expect(caller({ userId }).disconnectIdentity({ provider: 'github' })).resolves.toEqual({
      disconnected: true,
    });

    expect(await ScmIdentityModel.findByUser(serverDB, 'github', userId)).toBeNull();
    expect(await ScmIdentityModel.findByUser(serverDB, 'github', otherUserId)).not.toBeNull();
    expect(mocks.revokeToken).toHaveBeenCalledWith('ghu_mine');
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
      needsReauthorization: true,
      provider: 'github',
    });
    expect(JSON.stringify(identity)).not.toContain('secret');
  });

  it('reports an identity with a live refreshable token as ready', async () => {
    await ScmIdentityModel.upsert(serverDB, {
      credentials: {
        accessToken: 'ghu_live',
        refreshToken: 'ghr_live',
        refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      },
      externalLogin: 'arvinxx',
      externalUserId: '42',
      provider: 'github',
      tokenExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
      userId,
    });

    await expect(caller({ userId }).getIdentity({ provider: 'github' })).resolves.toMatchObject({
      needsReauthorization: false,
    });
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

  it('reports a wake target for the caller own open PR, and none without the GitHub App', async () => {
    await serverDB.insert(topics).values({ id: 'scm-router-topic', title: 't', userId });
    await ScmChangeRequestModel.upsert(serverDB, {
      links: { topicId: 'scm-router-topic' },
      number: 4,
      provider: 'github',
      repoFullName: 'a/wake',
      state: 'open',
      url: 'https://github.com/a/wake/pull/4',
      userId,
    });

    expect(await caller({ userId }).hasWakeTarget({ topicId: 'scm-router-topic' })).toBe(true);
    expect(
      await caller({ userId: otherUserId }).hasWakeTarget({ topicId: 'scm-router-topic' }),
    ).toBe(false);

    scmEnv.ENABLED_GITHUB_APP = false;
    try {
      expect(await caller({ userId }).hasWakeTarget({ topicId: 'scm-router-topic' })).toBe(false);
    } finally {
      scmEnv.ENABLED_GITHUB_APP = true;
    }
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

  describe('listRepositories', () => {
    const repo = (fullName: string, pushedAt: string | null) => ({
      defaultBranch: 'main',
      description: null,
      fullName,
      htmlUrl: `https://github.com/${fullName}`,
      ownerAvatarUrl: null,
      private: false,
      pushedAt,
    });

    afterEach(() => {
      mocks.listRepositories.mockReset();
      scmEnv.ENABLED_GITHUB_APP = true;
    });

    it('reports an unconfigured deployment without calling GitHub', async () => {
      scmEnv.ENABLED_GITHUB_APP = false;
      expect(await caller({ userId }).listRepositories()).toEqual({
        configured: false,
        installations: 0,
        repositories: [],
        truncated: false,
      });
      expect(mocks.listRepositories).not.toHaveBeenCalled();
    });

    it('reports no installations so the picker can ask to connect GitHub', async () => {
      expect(await caller({ userId }).listRepositories()).toEqual({
        configured: true,
        installations: 0,
        repositories: [],
        truncated: false,
      });
    });

    it('merges live installations, newest push first, skipping suspended ones', async () => {
      await bind('201', { userId });
      await bind('202', { userId });
      const suspended = await bind('203', { userId });
      await ScmInstallationModel.setSuspended(serverDB, suspended.id, true);
      await bind('204', { userId: otherUserId });
      mocks.listRepositories.mockImplementation(async (installationId: string) =>
        installationId === '201'
          ? {
              repositories: [
                repo('a/old', '2026-01-01T00:00:00Z'),
                repo('a/shared', '2026-03-01T00:00:00Z'),
              ],
              truncated: false,
            }
          : {
              repositories: [
                repo('b/new', '2026-05-01T00:00:00Z'),
                repo('A/Shared', '2026-03-01T00:00:00Z'),
              ],
              truncated: true,
            },
      );

      const result = await caller({ userId }).listRepositories();

      expect(mocks.listRepositories.mock.calls.map(([id]) => id).sort()).toEqual(['201', '202']);
      expect(result.installations).toBe(2);
      expect(result.truncated).toBe(true);
      expect(result.repositories.map((item) => item.fullName.toLowerCase())).toEqual([
        'b/new',
        'a/shared',
        'a/old',
      ]);
    });

    it('lists what it can when one installation fails, and errors only when all do', async () => {
      await bind('301', { userId });
      await bind('302', { userId });
      mocks.listRepositories.mockImplementation(async (installationId: string) => {
        if (installationId === '301') throw new Error('rate limited');
        return { repositories: [repo('c/ok', null)], truncated: false };
      });
      expect(
        (await caller({ userId }).listRepositories()).repositories.map((item) => item.fullName),
      ).toEqual(['c/ok']);

      mocks.listRepositories.mockRejectedValue(new Error('down'));
      await expect(caller({ userId }).listRepositories()).rejects.toMatchObject({
        code: 'BAD_GATEWAY',
      });
    });
  });
});

describe('scmRouter requester credential policy', () => {
  const workspaceId = 'scm-policy-ws';

  beforeEach(async () => {
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: 'Policy', primaryOwnerId: userId, slug: 'scm-policy' });
  });

  it('reads the policy as off for a member who cannot change it', async () => {
    await expect(
      caller({
        userId: otherUserId,
        workspaceId,
        workspaceRole: 'member',
      } as any).getRequesterCredentialPolicy(),
    ).resolves.toEqual({ canEdit: false, enabled: false });
  });

  it('lets an admin turn the policy on and records it in the audit log', async () => {
    const admin = caller({ userId, workspaceId, workspaceRole: 'admin' } as any);

    await expect(admin.updateRequesterCredentialPolicy({ enabled: true })).resolves.toEqual({
      enabled: true,
    });
    await expect(admin.getRequesterCredentialPolicy()).resolves.toEqual({
      canEdit: true,
      enabled: true,
    });

    const logs = await serverDB.select().from(workspaceAuditLogs);
    expect(logs).toEqual([
      expect.objectContaining({
        action: 'security.policy_updated',
        metadata: { policy: 'scm.requester_credential', previous: false, value: true },
        workspaceId,
      }),
    ]);
  });

  it('refuses a member who tries to change the policy', async () => {
    await expect(
      caller({
        userId: otherUserId,
        workspaceId,
        workspaceRole: 'member',
      } as any).updateRequesterCredentialPolicy({
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('has no policy outside a workspace', async () => {
    await expect(
      caller({ userId }).updateRequesterCredentialPolicy({ enabled: true }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('scmRouter.listCredentialGrants', () => {
  const workspaceId = 'scm-grants-ws';

  beforeEach(async () => {
    await serverDB
      .update(users)
      .set({ avatar: 'https://avatars.example.com/2.png', fullName: 'Member Two' })
      .where(eq(users.id, otherUserId));
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: 'Grants', primaryOwnerId: userId, slug: 'scm-grants' });
    const grant = (requesterUserId: string, operationId: string, at: string) =>
      ScmCredentialGrantModel.create(serverDB, {
        createdAt: new Date(at),
        deviceId: 'device-jp-1',
        operationId,
        path: 'hetero',
        repo: 'lobehub/lobehub',
        requesterUserId,
        result: 'issued',
        workspaceId,
      });
    await grant(userId, 'op-admin', '2026-11-17T01:00:00Z');
    await grant(otherUserId, 'op-member', '2026-11-17T02:00:00Z');
  });

  it('shows an admin every grant in the workspace with who requested it', async () => {
    const rows = await caller({
      userId,
      workspaceId,
      workspaceRole: 'admin',
    } as any).listCredentialGrants({});

    expect(rows.map((row) => row.operationId)).toEqual(['op-member', 'op-admin']);
    expect(rows[0]).toMatchObject({
      repo: 'lobehub/lobehub',
      requester: {
        avatar: 'https://avatars.example.com/2.png',
        id: otherUserId,
        name: 'Member Two',
      },
      result: 'issued',
    });
  });

  it("keeps a member to their own grants even when they ask for someone else's", async () => {
    const member = caller({ userId: otherUserId, workspaceId, workspaceRole: 'member' } as any);

    await expect(member.listCredentialGrants({ requesterUserId: userId })).resolves.toEqual([
      expect.objectContaining({ operationId: 'op-member' }),
    ]);
  });

  it('returns nothing outside a workspace', async () => {
    await expect(caller({ userId }).listCredentialGrants({})).resolves.toEqual([]);
  });
});
