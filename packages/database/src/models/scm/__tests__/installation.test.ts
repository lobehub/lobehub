// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { scmInstallations, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ScmInstallationModel } from '../installation';

const db: LobeChatDatabase = await getTestDB();

const userId = 'scm-install-user';
const otherUserId = 'scm-install-other';
const workspaceId = 'scm-install-ws';

/** Snapshot shared by the fixtures; individual tests override the parts they exercise. */
const account = {
  accountExternalId: 'ext-1',
  accountLogin: 'lobehub',
  accountType: 'organization' as const,
};

beforeEach(async () => {
  await db.delete(scmInstallations);
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  await db.delete(scmInstallations);
  await db.delete(users);
});

describe('ScmInstallationModel', () => {
  it('binds a new installation with defaults and reads it back by id and provider id', async () => {
    const row = await ScmInstallationModel.bind(db, {
      ...account,
      installationId: '1',
      provider: 'github',
      repositorySelection: 'all',
      userId,
    });

    // Optional fields default rather than persist as null/undefined.
    expect(row).toMatchObject({
      accountLogin: 'lobehub',
      metadata: {},
      repositories: [],
      revokedAt: null,
      suspendedAt: null,
      workspaceId: null,
    });

    await expect(ScmInstallationModel.findById(db, row.id)).resolves.toMatchObject({ id: row.id });
    await expect(
      ScmInstallationModel.findByProviderInstallationId(db, 'github', '1'),
    ).resolves.toMatchObject({ id: row.id });
  });

  it('returns null for an unknown id or provider installation', async () => {
    await expect(
      ScmInstallationModel.findById(db, '00000000-0000-0000-0000-000000000000'),
    ).resolves.toBeNull();
    await expect(
      ScmInstallationModel.findByProviderInstallationId(db, 'github', 'missing'),
    ).resolves.toBeNull();
  });

  it('re-binds an existing installation id in place, moving scope and clearing revocation', async () => {
    const first = await ScmInstallationModel.bind(db, {
      ...account,
      installationId: '9',
      provider: 'github',
      repositorySelection: 'all',
      userId,
    });
    await ScmInstallationModel.markRevoked(db, first.id);

    const again = await ScmInstallationModel.bind(db, {
      ...account,
      installationId: '9',
      installedByExternalLogin: 'octocat',
      installedByExternalUserId: '5',
      metadata: { events: ['push'] },
      provider: 'github',
      repositories: [{ externalId: 'r1', fullName: 'a/b' }],
      repositorySelection: 'selected',
      suspendedAt: new Date('2026-01-01T00:00:00.000Z'),
      userId: otherUserId,
      workspaceId,
    });

    expect(again.id).toBe(first.id);
    expect(again).toMatchObject({
      installedByExternalLogin: 'octocat',
      installedByExternalUserId: '5',
      metadata: { events: ['push'] },
      repositories: [{ externalId: 'r1', fullName: 'a/b' }],
      repositorySelection: 'selected',
      revokedAt: null,
      userId: otherUserId,
      workspaceId,
    });
    expect(again.suspendedAt).toBeInstanceOf(Date);
  });

  it('retires any other live row for the same provider account when binding under a new id', async () => {
    const stale = await ScmInstallationModel.bind(db, {
      ...account,
      installationId: 'old',
      provider: 'github',
      repositorySelection: 'all',
      userId,
    });

    await ScmInstallationModel.bind(db, {
      ...account,
      installationId: 'new',
      provider: 'github',
      repositorySelection: 'all',
      userId,
    });

    const [reread] = await db
      .select()
      .from(scmInstallations)
      .where(eq(scmInstallations.id, stale.id));
    expect(reread.revokedAt).toBeInstanceOf(Date);
  });

  it('lists only active personal installations for a personal scope', async () => {
    const active = await ScmInstallationModel.bind(db, {
      ...account,
      installationId: 'p1',
      provider: 'github',
      repositorySelection: 'all',
      userId,
    });
    const revoked = await ScmInstallationModel.bind(db, {
      accountExternalId: 'ext-2',
      accountLogin: 'other',
      accountType: 'user',
      installationId: 'p2',
      provider: 'github',
      repositorySelection: 'all',
      userId,
    });
    await ScmInstallationModel.markRevoked(db, revoked.id);
    // A workspace-scoped row must not leak into the personal list. It carries a
    // distinct provider account so `bind`'s retire step does not revoke `active`.
    await ScmInstallationModel.bind(db, {
      accountExternalId: 'ext-3',
      accountLogin: 'workspace-account',
      accountType: 'organization',
      installationId: 'w1',
      provider: 'github',
      repositorySelection: 'all',
      userId,
      workspaceId,
    });

    const list = await ScmInstallationModel.listByScope(db, { userId });
    expect(list.map((r) => r.id)).toEqual([active.id]);
  });

  it('lists active installations for a workspace scope', async () => {
    const scoped = await ScmInstallationModel.bind(db, {
      ...account,
      installationId: 'w1',
      provider: 'github',
      repositorySelection: 'all',
      userId,
      workspaceId,
    });
    await ScmInstallationModel.bind(db, {
      accountExternalId: 'ext-2',
      accountLogin: 'other',
      accountType: 'user',
      installationId: 'p2',
      provider: 'github',
      repositorySelection: 'all',
      userId,
    });

    const list = await ScmInstallationModel.listByScope(db, { userId, workspaceId });
    expect(list.map((r) => r.id)).toEqual([scoped.id]);
  });

  it('refreshes the snapshot, replaces repositories and toggles suspension and revocation', async () => {
    const row = await ScmInstallationModel.bind(db, {
      ...account,
      installationId: 'm1',
      provider: 'github',
      repositorySelection: 'all',
      userId,
    });

    await ScmInstallationModel.refreshSnapshot(db, row.id, { accountLogin: 'renamed' });
    await ScmInstallationModel.setRepositories(db, row.id, [{ externalId: 'r1', fullName: 'a/b' }]);
    await ScmInstallationModel.setSuspended(db, row.id, true);

    let reread = await ScmInstallationModel.findById(db, row.id);
    expect(reread).toMatchObject({
      accountLogin: 'renamed',
      repositories: [{ externalId: 'r1', fullName: 'a/b' }],
    });
    expect(reread!.suspendedAt).toBeInstanceOf(Date);

    await ScmInstallationModel.setSuspended(db, row.id, false);
    reread = await ScmInstallationModel.findById(db, row.id);
    expect(reread!.suspendedAt).toBeNull();

    await ScmInstallationModel.markRevoked(db, row.id);
    reread = await ScmInstallationModel.findById(db, row.id);
    expect(reread!.revokedAt).toBeInstanceOf(Date);
  });

  it('merges a repository change under a row lock, deduping adds and drops', async () => {
    const row = await ScmInstallationModel.bind(db, {
      ...account,
      installationId: 'c1',
      provider: 'github',
      repositories: [
        { externalId: 'r1', fullName: 'a/1' },
        { externalId: 'r2', fullName: 'a/2' },
      ],
      repositorySelection: 'selected',
      userId,
    });

    const next = await ScmInstallationModel.applyRepositoryChange(db, row.id, {
      // r2 is already granted → the add is dropped; rX is not granted → the removal is a no-op.
      added: [
        { externalId: 'r3', fullName: 'a/3' },
        { externalId: 'r2', fullName: 'a/2' },
      ],
      removed: [
        { externalId: 'r1', fullName: 'a/1' },
        { externalId: 'rX', fullName: 'a/x' },
      ],
    });

    expect(next.map((r) => r.externalId)).toEqual(['r2', 'r3']);
  });

  it('returns an empty list when applying a repository change to a missing installation', async () => {
    const result = await ScmInstallationModel.applyRepositoryChange(
      db,
      '00000000-0000-0000-0000-000000000000',
      { added: [], removed: [] },
    );
    expect(result).toEqual([]);
  });
});
