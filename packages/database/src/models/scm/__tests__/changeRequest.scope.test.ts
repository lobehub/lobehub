// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  acceptances,
  scmChangeRequests,
  scmInstallations,
  topics,
  users,
  workspaces,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { isFailingCheck, mergeChecks, ScmChangeRequestModel } from '../changeRequest';
import { ScmInstallationModel } from '../installation';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'scm-scope-user';
const otherUserId = 'scm-scope-other-user';
const topicId = 'scm-scope-topic';
const workspaceId = 'scm-scope-workspace';
const missingId = 'scm-scope-missing-row';

const sha = '3'.repeat(40);

const snapshot = {
  headSha: sha,
  number: 7,
  provider: 'github' as const,
  repoFullName: 'lobehub/lobehub',
  state: 'open' as const,
  url: 'https://github.com/lobehub/lobehub/pull/7',
  userId,
};

const check = (name: string, conclusion: string | undefined, status = 'completed') => ({
  conclusion,
  externalId: `check_run:${name}`,
  name,
  status,
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values({ id: topicId, userId });
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: workspaceId, primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  await serverDB.delete(scmChangeRequests);
  await serverDB.delete(scmInstallations);
  await serverDB.delete(acceptances);
  await serverDB.delete(topics);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

describe('scm check identity', () => {
  it('keys a check the provider named nothing by its external id alone', () => {
    const unnamed = {
      conclusion: 'success',
      externalId: 'status:deadbeef',
      name: '',
      status: 'completed',
    };
    // Without a name there is no namespace to build, so the id *is* the
    // identity — a later result for the same context still supersedes it.
    expect(mergeChecks(null, [unnamed])).toEqual([unnamed]);
    expect(mergeChecks([unnamed], [{ ...unnamed, conclusion: 'failure' }])).toEqual([
      { ...unnamed, conclusion: 'failure' },
    ]);
  });

  it('counts only a completed run with a failing conclusion as a failure', () => {
    const completed = (conclusion?: string) => ({
      conclusion,
      externalId: 'check_run:1',
      name: 'Test',
      status: 'completed',
    });

    expect(isFailingCheck(completed('failure'))).toBe(true);
    expect(isFailingCheck(completed('timed_out'))).toBe(true);
    expect(isFailingCheck(completed('success'))).toBe(false);
    expect(isFailingCheck(completed())).toBe(false);
    expect(isFailingCheck({ ...completed('failure'), status: 'queued' })).toBe(false);
  });
});

describe('ScmChangeRequestModel lookups', () => {
  it('resolves a change request by the provider id for it, within the provider', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      externalId: 'PR_node_1',
    });

    expect(
      await ScmChangeRequestModel.findByExternalId(serverDB, 'github', 'PR_node_1'),
    ).toMatchObject({ id: row.id });
    expect(
      await ScmChangeRequestModel.findByExternalId(serverDB, 'github', 'PR_node_missing'),
    ).toBeNull();
    expect(
      await ScmChangeRequestModel.findByExternalId(serverDB, 'gitlab', 'PR_node_1'),
    ).toBeNull();
  });

  it('lists every change request linked to one acceptance', async () => {
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({ subjectId: 's', subjectType: 'standalone', userId })
      .returning();

    const first = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      links: { acceptanceId: acceptance.id },
    });
    const second = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      links: { acceptanceId: acceptance.id },
      number: 8,
    });

    const rows = await ScmChangeRequestModel.listByAcceptance(serverDB, acceptance.id);
    expect(rows.map((row) => row.id).sort()).toEqual([first.id, second.id].sort());
    expect(
      await ScmChangeRequestModel.listByAcceptance(
        serverDB,
        '00000000-0000-0000-0000-000000000000',
      ),
    ).toEqual([]);
  });

  it('lists the change requests opened from one topic', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      links: { topicId },
      number: 41,
    });

    expect((await ScmChangeRequestModel.listByTopic(serverDB, topicId)).map((r) => r.id)).toEqual([
      row.id,
    ]);
    expect(await ScmChangeRequestModel.listByTopic(serverDB, 'topic-with-nothing')).toEqual([]);
  });

  it('shows a scope its own rows plus everything on the installations it connected', async () => {
    const installation = await ScmInstallationModel.bind(serverDB, {
      accountExternalId: '1',
      accountLogin: 'lobehub',
      accountType: 'organization',
      installationId: '91001',
      provider: 'github',
      repositorySelection: 'all',
      userId,
    });

    const mine = await ScmChangeRequestModel.upsert(serverDB, { ...snapshot, number: 21 });
    // A member's personal agent opened it, but it is on this user's
    // installation — a workspace must still see its own repositories.
    const viaInstallation = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      links: { installationId: installation.id },
      number: 22,
      userId: otherUserId,
    });
    const foreign = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      number: 23,
      userId: otherUserId,
    });

    const ids = (await ScmChangeRequestModel.listByScope(serverDB, { userId })).map(
      (row) => row.id,
    );
    expect(ids).toContain(mine.id);
    expect(ids).toContain(viaInstallation.id);
    expect(ids).not.toContain(foreign.id);

    expect(
      await ScmChangeRequestModel.listByScope(serverDB, { userId }, { limit: 1 }),
    ).toHaveLength(1);
  });

  it('scopes a workspace to its own rows, not its members’ personal ones', async () => {
    const inWorkspace = await ScmChangeRequestModel.upsert(serverDB, {
      ...snapshot,
      number: 31,
      userId,
      workspaceId,
    });
    await ScmChangeRequestModel.upsert(serverDB, { ...snapshot, number: 32, userId });

    const rows = await ScmChangeRequestModel.listByScope(serverDB, { userId, workspaceId });
    expect(rows.map((row) => row.id)).toEqual([inWorkspace.id]);
  });

  it('reports a missing row instead of guessing at it', async () => {
    expect(await ScmChangeRequestModel.attachLinks(serverDB, missingId, { topicId })).toBeNull();
    expect(
      await ScmChangeRequestModel.applyChecks(serverDB, missingId, { checks: [], headSha: sha }),
    ).toBeNull();
    expect(
      await ScmChangeRequestModel.applyReviewerDecision(serverDB, missingId, {
        decision: 'approved',
        reviewerId: 'reviewer-1',
      }),
    ).toEqual({ applied: false, reviewDecision: null });
  });

  it('refuses to invent a row when the replay finds nothing to lock', async () => {
    // The retry exists for exactly one case: losing the first-insert race.
    // If the row is not there either, the caller must hear about it rather
    // than receive a row that was never written.
    const spy = vi.spyOn(ScmChangeRequestModel as any, 'upsertOnce').mockResolvedValue(null);

    await expect(ScmChangeRequestModel.upsert(serverDB, snapshot)).rejects.toThrow(
      'scm change request vanished between insert and retry',
    );

    spy.mockRestore();
  });

  it('reports nothing for a repository name and number it never saw', async () => {
    await ScmChangeRequestModel.upsert(serverDB, snapshot);

    expect(
      await ScmChangeRequestModel.findByIdentity(serverDB, 'github', 'lobehub/lobehub', 999),
    ).toBeNull();
    expect(
      await ScmChangeRequestModel.findByIdentity(serverDB, 'gitlab', 'lobehub/lobehub', 7),
    ).toBeNull();
  });

  it('opens a row for a delivery that names no commit at all', async () => {
    // `opened` events may arrive without a head sha; the row still exists and
    // a later check-run delivery can settle against it.
    const { headSha: _omitted, ...withoutSha } = snapshot;
    const created = await ScmChangeRequestModel.upsert(serverDB, withoutSha);
    expect(created.headSha).toBeNull();
    expect(created.ciHeadSha).toBeNull();

    // A second delivery without a sha keeps whatever the row already has.
    await ScmChangeRequestModel.upsert(serverDB, { ...withoutSha, headSha: sha });
    const updated = await ScmChangeRequestModel.upsert(serverDB, withoutSha);
    expect(updated.headSha).toBe(sha);
  });

  it('holds every check for a commit the push has not made the head yet', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, snapshot);
    const other = '4'.repeat(40);

    const first = await ScmChangeRequestModel.applyChecks(serverDB, row.id, {
      checks: [check('Test', 'success')],
      headSha: other,
    });
    expect(first?.applied).toBe(false);

    // A second job of the same not-yet-head commit joins the bucket instead of
    // replacing it — dropping the first would lose a failure.
    await ScmChangeRequestModel.applyChecks(serverDB, row.id, {
      checks: [check('Lint', 'failure')],
      headSha: other,
    });
    const held = (await ScmChangeRequestModel.findById(serverDB, row.id))?.metadata?.pendingChecks;
    expect(held?.checks.map((entry) => entry.name).sort()).toEqual(['Lint', 'Test']);
  });

  it('rolls up the first commit reported for a row that has no ci head yet', async () => {
    const { headSha: _omitted, ...withoutSha } = snapshot;
    const row = await ScmChangeRequestModel.upsert(serverDB, withoutSha);

    const applied = await ScmChangeRequestModel.applyChecks(serverDB, row.id, {
      checks: [check('Test', 'success')],
      headSha: sha,
    });

    expect(applied).toMatchObject({ applied: true, ciStatus: 'success', previousCiStatus: null });
  });

  it('replaces the stored checks wholesale when the caller says so', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, snapshot);
    await ScmChangeRequestModel.applyChecks(serverDB, row.id, {
      checks: [check('Test', 'failure')],
      headSha: sha,
    });

    const replaced = await ScmChangeRequestModel.applyChecks(serverDB, row.id, {
      checks: [check('Test', 'success')],
      headSha: sha,
      replace: true,
    });

    expect(replaced?.ciStatus).toBe('success');
    expect(replaced?.row.checks).toHaveLength(1);
  });

  it('records a verdict with no timestamp of its own, and a dismissal that empties the rollup', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, snapshot);

    const approved = await ScmChangeRequestModel.applyReviewerDecision(serverDB, row.id, {
      decision: 'approved',
      reviewerId: 'reviewer-1',
    });
    expect(approved).toEqual({ applied: true, reviewDecision: 'approved' });

    // Dismissing the only reviewer leaves nobody asking for anything.
    const dismissed = await ScmChangeRequestModel.applyReviewerDecision(serverDB, row.id, {
      decision: null,
      reviewerId: 'reviewer-1',
    });
    expect(dismissed).toEqual({ applied: true, reviewDecision: null });
  });

  it('records a rollup decision and a lifecycle event on the row', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, snapshot);

    await ScmChangeRequestModel.setReviewDecision(serverDB, row.id, 'approved');
    expect((await ScmChangeRequestModel.findById(serverDB, row.id))?.reviewDecision).toBe(
      'approved',
    );

    await ScmChangeRequestModel.setReviewDecision(serverDB, row.id, null);
    expect((await ScmChangeRequestModel.findById(serverDB, row.id))?.reviewDecision).toBeNull();

    const at = new Date('2026-01-02T03:04:05.000Z');
    await ScmChangeRequestModel.recordEvent(serverDB, row.id, 'synchronized', at);
    expect(await ScmChangeRequestModel.findById(serverDB, row.id)).toMatchObject({
      lastEventAt: at,
      lastEventKind: 'synchronized',
    });

    // Without a stamp the event is recorded as of now, which is all the
    // debounce window needs.
    await ScmChangeRequestModel.recordEvent(serverDB, row.id, 'reopened');
    const reopened = await ScmChangeRequestModel.findById(serverDB, row.id);
    expect(reopened?.lastEventKind).toBe('reopened');
    expect(reopened?.lastEventAt).toBeInstanceOf(Date);
  });

  it('lets exactly one handler claim the tracking comment slot', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, snapshot);

    expect(await ScmChangeRequestModel.claimCommentSlot(serverDB, row.id)).toBe(true);
    // A second delivery of the same burst must not post a second comment.
    expect(await ScmChangeRequestModel.claimCommentSlot(serverDB, row.id)).toBe(false);

    // A claim that went stale — the post crashed — is takeable again.
    await serverDB
      .update(scmChangeRequests)
      .set({ metadata: { commentClaimedAt: new Date(Date.now() - 6 * 60_000).toISOString() } })
      .where(eq(scmChangeRequests.id, row.id));
    expect(await ScmChangeRequestModel.claimCommentSlot(serverDB, row.id)).toBe(true);

    // Once the comment is posted the slot is closed for good.
    await serverDB
      .update(scmChangeRequests)
      .set({ metadata: { lobehubCommentId: '99001' } })
      .where(eq(scmChangeRequests.id, row.id));
    expect(await ScmChangeRequestModel.claimCommentSlot(serverDB, row.id)).toBe(false);
  });

  it('gives the comment slot back when the post never happened', async () => {
    const row = await ScmChangeRequestModel.upsert(serverDB, snapshot);
    expect(await ScmChangeRequestModel.claimCommentSlot(serverDB, row.id)).toBe(true);

    await ScmChangeRequestModel.releaseCommentSlot(serverDB, row.id);

    const stored = await ScmChangeRequestModel.findById(serverDB, row.id);
    expect(stored?.metadata).not.toHaveProperty('commentClaimedAt');
    expect(await ScmChangeRequestModel.claimCommentSlot(serverDB, row.id)).toBe(true);
  });
});
