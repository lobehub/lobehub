// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScmInstallationModel } from '@/database/models/scm';
import { scmInstallations, users } from '@/database/schemas';

import { githubRepositoryOf, resolveScmCloneCredential } from '../cloneCredential';

const mintGitHubRepositoryToken = vi.hoisted(() => vi.fn());

vi.mock('../github/app', () => ({ mintGitHubRepositoryToken }));

const serverDB = await getTestDB();
const userId = 'scm-clone-credential-user';

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

const resolve = (url: string) =>
  resolveScmCloneCredential({
    configuration: { sources: [{ kind: 'git', url }] },
    db: serverDB,
    userId,
  });

beforeEach(async () => {
  mintGitHubRepositoryToken.mockReset();
  mintGitHubRepositoryToken.mockResolvedValue({
    expiresAt: '2026-01-01T00:00:00Z',
    token: 'ghs_minted',
  });
  await serverDB.insert(users).values({ id: userId }).onConflictDoNothing();
});

afterEach(async () => {
  await serverDB.delete(scmInstallations).where(eq(scmInstallations.userId, userId));
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('githubRepositoryOf', () => {
  it('reads owner/name off a github https source', () => {
    expect(githubRepositoryOf({ sources: [{ kind: 'git', url: 'https://github.com/o/r' }] })).toBe(
      'o/r',
    );
    expect(
      githubRepositoryOf({ sources: [{ kind: 'git', url: 'https://github.com/o/r.git' }] }),
    ).toBe('o/r');
  });

  it('ignores a source that is not a github https checkout', () => {
    // A credential attached to a host nobody checked is the one outcome worth
    // preventing here, so anything unrecognized yields no repository at all.
    expect(
      githubRepositoryOf({ sources: [{ kind: 'git', url: 'https://gitlab.com/o/r' }] }),
    ).toBeUndefined();
    expect(
      githubRepositoryOf({ sources: [{ kind: 'archive', url: 'https://github.com/o/r' }] }),
    ).toBeUndefined();
    expect(
      githubRepositoryOf({ sources: [{ kind: 'git', url: 'https://github.com/o/r/extra' }] }),
    ).toBeUndefined();
    expect(githubRepositoryOf(undefined)).toBeUndefined();
  });
});

describe('resolveScmCloneCredential', () => {
  it('mints a repository-scoped token from the installation that was granted it', async () => {
    await install({
      accountLogin: 'acme',
      installationId: '100',
      repositories: ['acme/app'],
    });

    const credential = await resolve('https://github.com/acme/app');

    expect(mintGitHubRepositoryToken).toHaveBeenCalledWith({
      installationId: '100',
      repoFullName: 'acme/app',
    });
    expect(credential).toEqual({
      header: `Authorization: Basic ${Buffer.from('x-access-token:ghs_minted').toString('base64')}`,
      urlPrefix: 'https://github.com/',
    });
  });

  it('matches an all-repositories installation by its account', async () => {
    // GitHub does not enumerate repositories for an `all` installation, so the
    // owner segment is the only thing there is to compare.
    await install({ accountLogin: 'acme', installationId: '101', repositorySelection: 'all' });

    expect(await resolve('https://github.com/acme/anything')).not.toBeNull();
    expect(await resolve('https://github.com/other/thing')).toBeNull();
  });

  it('does not answer for a repository the installation was not granted', async () => {
    await install({
      accountLogin: 'acme',
      installationId: '102',
      repositories: ['acme/other'],
    });

    expect(await resolve('https://github.com/acme/app')).toBeNull();
    expect(mintGitHubRepositoryToken).not.toHaveBeenCalled();
  });

  it('skips a suspended installation rather than minting a token it cannot use', async () => {
    await install({
      accountLogin: 'acme',
      installationId: '103',
      repositories: ['acme/app'],
      suspended: true,
    });

    expect(await resolve('https://github.com/acme/app')).toBeNull();
    expect(mintGitHubRepositoryToken).not.toHaveBeenCalled();
  });

  it('falls through when the App cannot mint, instead of failing the build', async () => {
    // An App without `contents: read` lands here; the caller then uses the
    // other credential path and the clone reports itself in the build log.
    await install({
      accountLogin: 'acme',
      installationId: '104',
      repositories: ['acme/app'],
    });
    mintGitHubRepositoryToken.mockResolvedValue(null);

    expect(await resolve('https://github.com/acme/app')).toBeNull();
  });

  it('never throws when the installation lookup fails', async () => {
    const db = {
      select: () => {
        throw new Error('database is down');
      },
    } as never;

    await expect(
      resolveScmCloneCredential({
        configuration: { sources: [{ kind: 'git', url: 'https://github.com/acme/app' }] },
        db,
        userId,
      }),
    ).resolves.toBeNull();
  });
});
