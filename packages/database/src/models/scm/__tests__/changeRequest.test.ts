// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  it('never calls a cancelled or unrecognized conclusion green', () => {
    // A cancelled workflow has not passed. Saying `success` here would hand
    // merge automation a green light it never earned; `failure` would be a
    // lie in the other direction, since nothing broke.
    expect(rollupCiStatus([check('Test', 'cancelled')])).toBe('unknown');
    expect(rollupCiStatus([check('Test', 'stale')])).toBe('unknown');
    expect(rollupCiStatus([check('Test', undefined)])).toBe('unknown');
    expect(rollupCiStatus([check('Lint', 'success'), check('Test', 'cancelled')])).toBe('unknown');

    // The green set is exactly success / neutral / skipped.
    expect(
      rollupCiStatus([check('a', 'success'), check('b', 'neutral'), check('c', 'skipped')]),
    ).toBe('success');
    // Something actually broken still outranks the inconclusive ones.
    expect(rollupCiStatus([check('Test', 'cancelled'), check('Build', 'failure')])).toBe('failure');
  });

  it('keeps two apps reporting the same check name apart', () => {
    // GitHub dedupes "latest per name" *within an app*; collapsing across
    // apps would let one app's pass erase another app's failure.
    const failing = {
      appId: '1',
      conclusion: 'failure',
      externalId: 'check_run:10',
      name: 'Test',
      reportedAt: '2026-09-20T06:00:00Z',
      status: 'completed',
    };
    const passing = {
      appId: '2',
      conclusion: 'success',
      externalId: 'check_run:11',
      name: 'Test',
      reportedAt: '2026-09-20T06:10:00Z',
      status: 'completed',
    };

    const merged = mergeChecks([failing], [passing]);
    expect(merged).toHaveLength(2);
    expect(rollupCiStatus(merged)).toBe('failure');
  });

  it('replaces a failed attempt when the job is rerun under a new id', () => {
    // A rerun mints a new `check_run:<id>`; keeping both would pin the
    // rollup to failure forever.
    const failed = {
      appId: '1',
      conclusion: 'failure',
      externalId: 'check_run:1',
      name: 'Test',
      reportedAt: '2026-09-20T06:00:00Z',
      status: 'completed',
    };
    const rerun = {
      appId: '1',
      conclusion: 'success',
      externalId: 'check_run:2',
      name: 'Test',
      reportedAt: '2026-09-20T06:30:00Z',
      status: 'completed',
    };

    const merged = mergeChecks([failed], [rerun]);
    expect(merged).toEqual([rerun]);
    expect(rollupCiStatus(merged)).toBe('success');

    // Two providers reporting the same name stay apart.
    const legacy = {
      conclusion: 'failure',
      externalId: 'status:Test',
      name: 'Test',
      status: 'completed',
    };
    expect(mergeChecks([rerun], [legacy])).toHaveLength(2);
  });

  it('is unknown with no checks, pending while any runs, failure over success', () => {
    expect(rollupCiStatus([])).toBe('unknown');
    expect(rollupCiStatus([check('a', 'success'), check('b', undefined, 'in_progress')])).toBe(
      'pending',
    );
    expect(rollupCiStatus([check('a', 'success'), check('b', 'failure')])).toBe('failure');
    expect(rollupCiStatus([check('a', 'success'), check('b', 'skipped')])).toBe('success');
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

  it('holds checks reported before the push that makes their commit the head', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, snapshot);

    // GitHub reported the job for sha2 before the `synchronize` landed.
    const early = await ScmChangeRequestModel.applyChecks(serverDB, row.id, {
      checks: [check('Test', 'success')],
      headSha: sha2,
    });
    expect(early?.applied).toBe(false);
    expect(early?.row.ciStatus).toBeNull();
    expect(early?.row.metadata.pendingChecks?.sha).toBe(sha2);

    // The push arrives: the held results are this commit's CI, not leftovers.
    const pushed = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      eventKind: 'synchronized',
      headSha: sha2,
    });
    expect(pushed.ciHeadSha).toBe(sha2);
    expect(pushed.ciStatus).toBe('success');
    expect(pushed.checks).toHaveLength(1);
    expect(pushed.metadata.pendingChecks).toBeUndefined();
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

  it('follows a repository rename instead of splitting the change request', async () => {
    const created = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      externalId: 'PR_node_1',
      eventKind: 'opened',
    });

    // The repository is renamed; every later delivery carries the new name.
    const renamed = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      eventKind: 'synchronized',
      externalId: 'PR_node_1',
      repoFullName: 'lobehub/lobehub-renamed',
      url: 'https://github.com/lobehub/lobehub-renamed/pull/7',
    });

    expect(renamed.id).toBe(created.id);
    expect(renamed.repoFullName).toBe('lobehub/lobehub-renamed');
    expect(
      await ScmChangeRequestModel.findByIdentity(
        serverDB,
        'github',
        'lobehub/lobehub-renamed',
        snapshot.number,
      ),
    ).toMatchObject({ id: created.id });
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

    // A stale delivery of A's earlier verdict does not undo a newer one,
    // and says so, so the caller can skip the downstream side effects.
    expect(
      await ScmChangeRequestModel.applyReviewerDecision(serverDB, row.id, {
        at: new Date('2026-09-20T12:00:00Z'),
        decision: 'approved',
        reviewerId: 'rev-a',
      }),
    ).toMatchObject({ applied: true });
    expect(
      await ScmChangeRequestModel.applyReviewerDecision(serverDB, row.id, {
        at: new Date('2026-09-20T09:00:00Z'),
        decision: 'changes_requested',
        reviewerId: 'rev-a',
      }),
    ).toMatchObject({ applied: false, reviewDecision: 'approved' });
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

  it('serializes a merge against an older synchronize that overlaps it', async () => {
    await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      eventAt: new Date('2026-09-20T08:00:00Z'),
      eventKind: 'opened',
      state: 'open',
    });

    // Both deliveries start from the same open row; the row lock decides
    // the order, and the merge must survive whichever writes last.
    await Promise.all([
      ScmChangeRequestModel.upsert(serverDB, {
        ...snapshot,
        eventAt: new Date('2026-09-20T12:00:00Z'),
        eventKind: 'merged',
        mergedAt: new Date('2026-09-20T12:00:00Z'),
        state: 'merged',
      }),
      ScmChangeRequestModel.upsert(serverDB, {
        ...snapshot,
        eventAt: new Date('2026-09-20T11:00:00Z'),
        eventKind: 'synchronized',
        headSha: sha2,
        state: 'open',
      }),
    ]);

    const after = await ScmChangeRequestModel.findById(
      serverDB,
      (await ScmChangeRequestModel.findByIdentity(
        serverDB,
        snapshot.provider,
        snapshot.repoFullName,
        snapshot.number,
      ))!.id,
    );
    expect(after?.state).toBe('merged');
    expect(after?.headSha).toBe(sha1);
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

  it('keeps an existing owner when told to, whatever owner the delivery carries', async () => {
    const otherUser = 'scm-model-user-keep';
    await serverDB.insert(users).values({ id: otherUser });
    // One delivery routed the pull request to its author, with a link.
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({ subjectId: 's', subjectType: 'standalone', userId })
      .returning();
    const routed = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      links: { acceptanceId: acceptance.id },
      metadata: { routedBy: 'author' },
    });

    // A concurrent one resolved nothing and falls back to someone else.
    // It must not move the row — which would read as a tenant change and
    // clear the link the first one stored.
    const after = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      keepOwner: true,
      metadata: { routedBy: 'installation' },
      userId: otherUser,
    });

    expect(after.id).toBe(routed.id);
    expect(after).toMatchObject({ acceptanceId: acceptance.id, userId });
    expect(after.metadata.routedBy).toBe('author');

    await serverDB.delete(users).where(eq(users.id, otherUser));
  });

  it('changes pendingWake in place, without reading the metadata bag first', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      metadata: { lobehubCommentId: 'c-1' },
    });

    // Deliveries for one pull request are handled concurrently, so a
    // read-modify-write on the whole column would let one handler erase
    // what another stored in between — the tracking comment id here, which
    // would then be posted a second time. The invariant is stronger than
    // any interleaving a test can stage: these two never read the row.
    const reads = vi.fn();
    const watched = new Proxy(serverDB, {
      get(target, prop, receiver) {
        if (prop === 'select') reads();
        return Reflect.get(target, prop, receiver);
      },
    }) as typeof serverDB;

    await ScmChangeRequestModel.markPendingWake(watched, row.id, 'ci_failed');
    // First reason of the burst wins; a second mark is a no-op.
    await ScmChangeRequestModel.markPendingWake(watched, row.id, 'review_commented');
    expect(reads).not.toHaveBeenCalled();

    let after = await ScmChangeRequestModel.findById(serverDB, row.id);
    expect(after?.metadata).toMatchObject({
      lobehubCommentId: 'c-1',
      pendingWake: { reason: 'ci_failed' },
    });

    await ScmChangeRequestModel.clearPendingWake(watched, row.id);
    expect(reads).not.toHaveBeenCalled();

    after = await ScmChangeRequestModel.findById(serverDB, row.id);
    expect(after?.metadata.pendingWake).toBeUndefined();
    expect(after?.metadata.lobehubCommentId).toBe('c-1');
  });

  it('counts wakes up to the cap, and keeps the rest of the metadata bag', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      metadata: { repoPrivate: true },
    });
    expect(await ScmChangeRequestModel.reserveWake(serverDB, row.id, 2)).toBe(1);
    expect(await ScmChangeRequestModel.reserveWake(serverDB, row.id, 2, 'ci_failed')).toBe(2);
    // Spent: the cap is the WHERE clause, so the row is simply not updated.
    expect(await ScmChangeRequestModel.reserveWake(serverDB, row.id, 2, 'ci_failed')).toBeNull();

    const after = await ScmChangeRequestModel.findById(serverDB, row.id);
    expect(after?.wakeCount).toBe(2);
    expect(after?.lastWakeAt).not.toBeNull();
    expect(after?.metadata).toMatchObject({
      lastWake: { at: expect.any(String), reason: 'ci_failed' },
      repoPrivate: true,
    });

    await ScmChangeRequestModel.releaseWake(serverDB, row.id);
    expect((await ScmChangeRequestModel.findById(serverDB, row.id))?.wakeCount).toBe(1);
  });

  it('never lets a released wake take the counter below zero', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, snapshot);
    await ScmChangeRequestModel.releaseWake(serverDB, row.id);
    expect((await ScmChangeRequestModel.findById(serverDB, row.id))?.wakeCount).toBe(0);
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
