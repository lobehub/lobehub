// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { acceptances, scmWebhookDeliveries, users } from '../../../schemas';
import { mergeChecks, rollupCiStatus, ScmChangeRequestModel } from '../changeRequest';
import { ScmWebhookDeliveryModel } from '../delivery';
import { ScmInstallationModel } from '../installation';

const serverDB = await getTestDB();
const userId = 'scm-model-user';

const sha1 = '1'.repeat(40);
const sha2 = '2'.repeat(40);

const snapshot = {
  headSha: sha1,
  number: 7,
  provider: 'github' as const,
  repoFullName: 'lobehub/lobehub',
  state: 'open' as const,
  url: 'https://github.com/lobehub/lobehub/pull/7',
  userId,
};

const check = (name: string, conclusion?: string, status = 'completed') => ({
  conclusion,
  externalId: `check_run:${name}`,
  name,
  status,
});

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(scmWebhookDeliveries);
  await serverDB.delete(users);
});

describe('rollupCiStatus', () => {
  it('is unknown with no checks, pending while any runs, failure over success', () => {
    expect(rollupCiStatus([])).toBe('unknown');
    expect(rollupCiStatus([check('a', 'success'), check('b', undefined, 'in_progress')])).toBe(
      'pending',
    );
    expect(rollupCiStatus([check('a', 'success'), check('b', 'failure')])).toBe('failure');
    expect(
      rollupCiStatus([check('a', 'success'), check('b', 'skipped'), check('c', 'cancelled')]),
    ).toBe('success');
  });

  it('merges by external id with the incoming check winning', () => {
    const merged = mergeChecks(
      [check('a', undefined, 'queued'), check('b', 'success')],
      [check('a', 'failure')],
    );
    expect(merged).toEqual([check('a', 'failure'), check('b', 'success')]);
  });
});

describe('ScmChangeRequestModel', () => {
  it('upserts by identity, keeps links once set, and resets CI on a new head', async () => {
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({ subjectId: 's', subjectType: 'standalone', userId })
      .returning();

    const created = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      eventKind: 'opened',
      links: { acceptanceId: acceptance.id },
      title: 'first',
    });
    expect(created.acceptanceId).toBe(acceptance.id);
    expect(created.lastEventKind).toBe('opened');

    await ScmChangeRequestModel.applyChecks(serverDB, created.id, {
      checks: [check('unit', 'failure')],
      headSha: sha1,
    });

    // A later event without links and with a new head commit.
    const updated = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      eventKind: 'synchronized',
      headSha: sha2,
      title: null,
    });
    expect(updated.id).toBe(created.id);
    expect(updated.acceptanceId).toBe(acceptance.id);
    expect(updated.title).toBe('first');
    expect(updated.headSha).toBe(sha2);
    expect(updated.ciStatus).toBeNull();
    expect(updated.checks).toBeNull();
    expect(updated.lastEventKind).toBe('synchronized');
  });

  it('drops check results for a commit that is no longer the head', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, { ...snapshot, headSha: sha2 });

    const stale = await ScmChangeRequestModel.applyChecks(serverDB, row.id, {
      checks: [check('unit', 'failure')],
      headSha: sha1,
    });
    expect(stale).toMatchObject({ applied: false, ciStatus: null });

    const fresh = await ScmChangeRequestModel.applyChecks(serverDB, row.id, {
      checks: [check('unit', undefined, 'in_progress'), check('lint', 'success')],
      headSha: sha2,
    });
    expect(fresh).toMatchObject({ applied: true, ciStatus: 'pending', previousCiStatus: null });

    const done = await ScmChangeRequestModel.applyChecks(serverDB, row.id, {
      checks: [check('unit', 'success')],
      headSha: sha2,
    });
    expect(done).toMatchObject({ applied: true, ciStatus: 'success', previousCiStatus: 'pending' });
    expect(done?.row.checks).toHaveLength(2);
  });

  it('finds rows by head sha and fills only missing links', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, snapshot);
    const [installation] = [
      await ScmInstallationModel.bind(serverDB, {
        accountExternalId: '1',
        accountLogin: 'lobehub',
        accountType: 'organization',
        installationId: '90001',
        provider: 'github',
        repositorySelection: 'all',
        userId,
      }),
    ];

    await ScmChangeRequestModel.attachLinks(serverDB, row.id, { installationId: installation.id });
    const other = await ScmInstallationModel.bind(serverDB, {
      accountExternalId: '2',
      accountLogin: 'other',
      accountType: 'user',
      installationId: '90002',
      provider: 'github',
      repositorySelection: 'all',
      userId,
    });
    const after = await ScmChangeRequestModel.attachLinks(serverDB, row.id, {
      installationId: other.id,
    });
    expect(after?.installationId).toBe(installation.id);

    expect(
      await ScmChangeRequestModel.findByHeadSha(serverDB, 'github', 'lobehub/lobehub', sha1),
    ).toHaveLength(1);
    expect(
      await ScmChangeRequestModel.findByHeadSha(serverDB, 'github', 'lobehub/lobehub', sha2),
    ).toHaveLength(0);
  });

  it('counts wakes', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, snapshot);
    expect(await ScmChangeRequestModel.recordWake(serverDB, row.id)).toBe(1);
    expect(await ScmChangeRequestModel.recordWake(serverDB, row.id)).toBe(2);
    expect((await ScmChangeRequestModel.findById(serverDB, row.id))?.lastWakeAt).not.toBeNull();
  });
});

describe('ScmWebhookDeliveryModel', () => {
  it('claims a delivery once and settles it', async () => {
    const key = { deliveryId: 'd-1', provider: 'github' as const };
    const first = await ScmWebhookDeliveryModel.claim(serverDB, { ...key, event: 'pull_request' });
    expect(first?.status).toBe('received');
    expect(
      await ScmWebhookDeliveryModel.claim(serverDB, { ...key, event: 'pull_request' }),
    ).toBeNull();

    await ScmWebhookDeliveryModel.settle(serverDB, key, {
      status: 'processed',
      error: 'scr_x opened',
    });
    const [row] = await serverDB.select().from(scmWebhookDeliveries);
    expect(row).toMatchObject({ error: 'scr_x opened', status: 'processed' });
    expect(row.processedAt).not.toBeNull();

    expect(await ScmWebhookDeliveryModel.pruneBefore(serverDB, new Date(Date.now() + 1000))).toBe(
      1,
    );
  });
});

describe('ScmInstallationModel', () => {
  it('re-binding the same installation keeps its id, moves scope, and clears revocation', async () => {
    const params = {
      accountExternalId: '1',
      accountLogin: 'lobehub',
      accountType: 'organization' as const,
      installationId: '90001',
      provider: 'github' as const,
      repositorySelection: 'all' as const,
      userId,
    };
    const first = await ScmInstallationModel.bind(serverDB, params);
    await ScmInstallationModel.markRevoked(serverDB, first.id);

    const second = await ScmInstallationModel.bind(serverDB, {
      ...params,
      repositorySelection: 'selected',
      repositories: [{ externalId: '9', fullName: 'lobehub/x' }],
    });
    expect(second.id).toBe(first.id);
    expect(second.revokedAt).toBeNull();
    expect(second.repositorySelection).toBe('selected');

    expect(await ScmInstallationModel.listByScope(serverDB, { userId })).toHaveLength(1);
    expect(await ScmInstallationModel.listByScope(serverDB, { userId: 'nobody' })).toHaveLength(0);
  });
});
