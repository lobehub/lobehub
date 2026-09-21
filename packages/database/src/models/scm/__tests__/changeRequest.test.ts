// @vitest-environment node
import { eq } from 'drizzle-orm';
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

  it('keeps the newer report when deliveries for one check arrive out of order', () => {
    const at = (
      name: string,
      conclusion: string | undefined,
      reportedAt: string,
      status = 'completed',
    ) => ({
      conclusion,
      externalId: 'check_run:9',
      name,
      reportedAt,
      status,
    });

    // A delayed `queued` must not un-finish a completed run.
    const completed = at('Test', 'failure', '2026-09-20T06:05:00Z');
    const stalePending = at('Test', undefined, '2026-09-20T06:01:00Z', 'queued');
    expect(mergeChecks([completed], [stalePending])).toEqual([completed]);

    // A delayed success must not hide a newer failure.
    const staleSuccess = at('Test', 'success', '2026-09-20T06:02:00Z');
    expect(mergeChecks([completed], [staleSuccess])).toEqual([completed]);

    // The genuinely newer result still wins.
    const newer = at('Test', 'success', '2026-09-20T06:09:00Z');
    expect(mergeChecks([completed], [newer])).toEqual([newer]);

    // With no timestamps at all, completed still beats pending.
    const bare = { externalId: 'check_run:8', name: 'Lint', status: 'queued' };
    const bareDone = {
      conclusion: 'success',
      externalId: 'check_run:8',
      name: 'Lint',
      status: 'completed',
    };
    expect(mergeChecks([bareDone], [bare])).toEqual([bareDone]);
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

  it('ignores a delivery older than the last one applied, and never reopens a merge', async () => {
    const merged = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      eventAt: new Date('2026-09-20T12:00:00Z'),
      eventKind: 'merged',
      mergedAt: new Date('2026-09-20T12:00:00Z'),
      state: 'merged',
    });
    expect(merged.state).toBe('merged');

    // A redelivered `opened` from before the merge: links still fill, the
    // lifecycle does not move.
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({ subjectId: 's', subjectType: 'standalone', userId })
      .returning();
    const replayed = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      eventAt: new Date('2026-09-20T09:00:00Z'),
      eventKind: 'opened',
      headSha: sha2,
      links: { acceptanceId: acceptance.id },
      state: 'open',
    });
    expect(replayed.state).toBe('merged');
    expect(replayed.headSha).toBe(sha1);
    expect(replayed.lastEventKind).toBe('merged');
    expect(replayed.acceptanceId).toBe(acceptance.id);

    // Even a *newer* event cannot walk a merge back to open.
    const later = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      eventAt: new Date('2026-09-20T18:00:00Z'),
      eventKind: 'reopened',
      state: 'open',
    });
    expect(later.state).toBe('merged');
  });

  it('keeps every check when deliveries for one commit land concurrently', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, snapshot);
    const names = ['Lint', 'Test', 'Build', 'Typecheck', 'E2E', 'Docs'];

    await Promise.all(
      names.map((name) =>
        ScmChangeRequestModel.applyChecks(serverDB, row.id, {
          checks: [check(name, name === 'Test' ? 'failure' : 'success')],
          headSha: sha1,
        }),
      ),
    );

    const after = await ScmChangeRequestModel.findById(serverDB, row.id);
    expect((after?.checks ?? []).map((c) => c.name).sort()).toEqual([...names].sort());
    expect(after?.ciStatus).toBe('failure');
  });

  it('follows the installation to a new tenant and drops the old tenant links', async () => {
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({ subjectId: 's', subjectType: 'standalone', userId })
      .returning();
    const first = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      links: { acceptanceId: acceptance.id },
    });
    expect(first.acceptanceId).toBe(acceptance.id);

    await serverDB.insert(users).values({ id: 'scm-model-user-2' });
    const moved = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      userId: 'scm-model-user-2',
    });
    expect(moved.id).toBe(first.id);
    expect(moved.userId).toBe('scm-model-user-2');
    expect(moved.acceptanceId).toBeNull();
    expect(moved.topicId).toBeNull();
  });

  it('rolls up review verdicts per reviewer, in any delivery order', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, snapshot);

    // Reviewer A requests changes, reviewer B approves afterwards: the
    // outstanding request still governs.
    await ScmChangeRequestModel.applyReviewerDecision(serverDB, row.id, {
      at: new Date('2026-09-20T08:00:00Z'),
      decision: 'changes_requested',
      reviewerId: 'rev-a',
    });
    await ScmChangeRequestModel.applyReviewerDecision(serverDB, row.id, {
      at: new Date('2026-09-20T08:30:00Z'),
      decision: 'approved',
      reviewerId: 'rev-b',
    });
    expect((await ScmChangeRequestModel.findById(serverDB, row.id))?.reviewDecision).toBe(
      'changes_requested',
    );

    // A stale delivery of A's earlier verdict does not undo a newer one.
    await ScmChangeRequestModel.applyReviewerDecision(serverDB, row.id, {
      at: new Date('2026-09-20T12:00:00Z'),
      decision: 'approved',
      reviewerId: 'rev-a',
    });
    await ScmChangeRequestModel.applyReviewerDecision(serverDB, row.id, {
      at: new Date('2026-09-20T09:00:00Z'),
      decision: 'changes_requested',
      reviewerId: 'rev-a',
    });
    expect((await ScmChangeRequestModel.findById(serverDB, row.id))?.reviewDecision).toBe(
      'approved',
    );

    // A dismisses their own review: only B's approval is left.
    await ScmChangeRequestModel.applyReviewerDecision(serverDB, row.id, {
      at: new Date('2026-09-20T13:00:00Z'),
      decision: null,
      reviewerId: 'rev-a',
    });
    const after = await ScmChangeRequestModel.findById(serverDB, row.id);
    expect(after?.reviewDecision).toBe('approved');
    expect(Object.keys(after?.metadata.reviewers ?? {})).toEqual(['rev-b']);
  });

  it('clears the closure stamp when a pull request reopens', async () => {
    const closedAt = new Date('2026-09-20T10:00:00Z');
    const closed = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      closedAt,
      eventKind: 'closed',
      state: 'closed',
    });
    expect(closed.closedAt).toEqual(closedAt);

    // GitHub reports `closed_at: null` on a reopen; keeping the old stamp
    // would leave the row open and closed at once.
    const reopened = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      closedAt: null,
      eventKind: 'reopened',
      state: 'open',
    });
    expect(reopened.state).toBe('open');
    expect(reopened.closedAt).toBeNull();
    // A descriptive field the event did not carry is still kept.
    expect(reopened.title).toBe(closed.title);
  });

  it('keeps concurrent repository grants from overwriting each other', async () => {
    const repo = (id: string) => ({ externalId: id, fullName: `arvinxx/r${id}` });
    const installation = await ScmInstallationModel.bind(serverDB, {
      accountExternalId: 'acct-repos',
      accountLogin: 'arvinxx',
      accountType: 'user',
      installationId: '500',
      provider: 'github',
      repositories: [repo('1'), repo('2')],
      repositorySelection: 'selected',
      userId,
    });

    await Promise.all([
      ScmInstallationModel.applyRepositoryChange(serverDB, installation.id, {
        added: [repo('3')],
        removed: [],
      }),
      ScmInstallationModel.applyRepositoryChange(serverDB, installation.id, {
        added: [],
        removed: [repo('1')],
      }),
      ScmInstallationModel.applyRepositoryChange(serverDB, installation.id, {
        added: [repo('4')],
        removed: [],
      }),
    ]);

    const after = await ScmInstallationModel.findById(serverDB, installation.id);
    expect((after?.repositories ?? []).map((r) => r.externalId).sort()).toEqual(['2', '3', '4']);
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

  it('lets a failed or abandoned delivery be replayed, but never a settled one', async () => {
    const key = { deliveryId: 'd-2', provider: 'github' as const };
    const claim = () => ScmWebhookDeliveryModel.claim(serverDB, { ...key, event: 'pull_request' });

    expect((await claim())?.status).toBe('received');
    // In flight: a redelivery must not run the handler a second time.
    expect(await claim()).toBeNull();

    // Failed: redelivery is how GitHub recovers the event, so it is claimable.
    await ScmWebhookDeliveryModel.settle(serverDB, key, { error: 'boom', status: 'failed' });
    const retried = await claim();
    expect(retried).toMatchObject({ error: null, status: 'received' });
    expect(retried?.processedAt).toBeNull();

    // Settled: nothing to redo.
    await ScmWebhookDeliveryModel.settle(serverDB, key, { status: 'processed' });
    expect(await claim()).toBeNull();
    await ScmWebhookDeliveryModel.settle(serverDB, key, { status: 'skipped' });
    expect(await claim()).toBeNull();

    // Stuck in `received` past the window — the process died mid-flight.
    await serverDB
      .update(scmWebhookDeliveries)
      .set({
        processedAt: null,
        receivedAt: new Date(Date.now() - 10 * 60_000),
        status: 'received',
      })
      .where(eq(scmWebhookDeliveries.deliveryId, 'd-2'));
    expect((await claim())?.status).toBe('received');
  });
});

describe('ScmInstallationModel', () => {
  it('retires the stale row when the same account comes back under a new installation id', async () => {
    const base = {
      accountExternalId: 'acct-1',
      accountLogin: 'arvinxx',
      accountType: 'user' as const,
      provider: 'github' as const,
      repositorySelection: 'all' as const,
      userId,
    };
    const old = await ScmInstallationModel.bind(serverDB, { ...base, installationId: '100' });
    const fresh = await ScmInstallationModel.bind(serverDB, { ...base, installationId: '200' });
    expect(fresh.id).not.toBe(old.id);

    const listed = await ScmInstallationModel.listByScope(serverDB, { userId });
    expect(listed.map((i) => i.installationId)).toEqual(['200']);
    expect((await ScmInstallationModel.findById(serverDB, old.id))?.revokedAt).not.toBeNull();
  });

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
