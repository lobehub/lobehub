// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScmInstallationModel } from '@/database/models/scm';
import { scmInstallations, users } from '@/database/schemas';

import { listScopeGitHubRepositoryBranches } from '../repositories';

const scmEnv = vi.hoisted(() => ({ ENABLED_GITHUB_APP: true }));
const listBranches = vi.hoisted(() => vi.fn());

vi.mock('@/envs/scm', () => ({ scmEnv }));
vi.mock('../github/app', () => ({
  listGitHubInstallationRepositoryBranches: listBranches,
  listGitHubInstallationRepositoryDetails: vi.fn(),
}));

const serverDB = await getTestDB();
const userId = 'scm-repositories-user';
const scope = { userId, workspaceId: null };

const install = (params: {
  accountLogin: string;
  installationId: string;
  repositories?: string[];
  repositorySelection?: 'all' | 'selected';
  suspended?: boolean;
}) =>
  ScmInstallationModel.bind(serverDB, {
    accountExternalId: `ext-${params.installationId}`,
    accountLogin: params.accountLogin,
    accountType: 'organization',
    installationId: params.installationId,
    provider: 'github',
    repositories: (params.repositories ?? []).map((fullName, index) => ({
      externalId: `${params.installationId}-${index}`,
      fullName,
    })),
    repositorySelection: params.repositorySelection ?? 'selected',
    suspendedAt: params.suspended ? new Date() : null,
    userId,
  });

const branchesOf = (repoFullName: string) =>
  listScopeGitHubRepositoryBranches(serverDB, scope, { limit: 1000, repoFullName });

beforeEach(async () => {
  listBranches.mockReset();
  listBranches.mockResolvedValue(['main']);
  scmEnv.ENABLED_GITHUB_APP = true;
  await serverDB.insert(users).values({ id: userId }).onConflictDoNothing();
});

afterEach(async () => {
  await serverDB.delete(scmInstallations).where(eq(scmInstallations.userId, userId));
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('listScopeGitHubRepositoryBranches', () => {
  it('reads through the installation that was granted the repository', async () => {
    await install({ accountLogin: 'acme', installationId: '11', repositories: ['acme/other'] });
    await install({ accountLogin: 'acme', installationId: '12', repositories: ['acme/app'] });

    expect(await branchesOf('acme/app')).toEqual(['main']);
    expect(listBranches).toHaveBeenCalledWith({
      installationId: '12',
      limit: 1000,
      repoFullName: 'acme/app',
    });
  });

  it('matches an all-repositories installation by account', async () => {
    await install({ accountLogin: 'Acme', installationId: '21', repositorySelection: 'all' });

    expect(await branchesOf('acme/anything')).toEqual(['main']);
    expect(listBranches).toHaveBeenCalledWith(expect.objectContaining({ installationId: '21' }));
  });

  it('answers null when no live installation grants the repository', async () => {
    await install({ accountLogin: 'acme', installationId: '31', repositories: ['acme/other'] });
    await install({
      accountLogin: 'acme',
      installationId: '32',
      repositories: ['acme/app'],
      suspended: true,
    });

    expect(await branchesOf('acme/app')).toBeNull();
    expect(listBranches).not.toHaveBeenCalled();
  });

  it('answers null without reading anything when the GitHub App is not configured', async () => {
    scmEnv.ENABLED_GITHUB_APP = false;
    await install({ accountLogin: 'acme', installationId: '41', repositorySelection: 'all' });

    expect(await branchesOf('acme/app')).toBeNull();
    expect(listBranches).not.toHaveBeenCalled();
  });
});
