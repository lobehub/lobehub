// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import type { ScmActorAssociation } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScmChangeRequestModel, ScmInstallationModel } from '@/database/models/scm';
import {
  acceptances,
  agents,
  scmWebhookDeliveries,
  topics,
  users,
  verifyRuns,
  works,
} from '@/database/schemas';

import { SCM_MAX_WAKES, ScmControlService } from '../ScmControlService';
import { parseTrackingMarker } from '../trackingComment';
import type { ScmInboundEvent } from '../types';

const serverDB = await getTestDB();
const userId = 'scm-control-user';

const mocks = vi.hoisted(() => ({
  execAgent: vi.fn(),
  jobLog: vi.fn(),
  postComment: vi.fn(),
  redisSet: vi.fn(),
  reviewFeedback: vi.fn(),
  updateComment: vi.fn(),
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return { execAgent: mocks.execAgent };
  }),
}));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => ({ set: mocks.redisSet }),
}));
vi.mock('../github/app', () => ({
  fetchGitHubJobLogTail: mocks.jobLog,
  fetchGitHubReviewFeedback: mocks.reviewFeedback,
  postGitHubPullRequestComment: mocks.postComment,
  updateGitHubPullRequestComment: mocks.updateComment,
}));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.test/' } }));
vi.mock('@/server/workflows/expertiseRejection', () => ({
  ExpertiseRejectionWorkflow: { trigger: vi.fn(async () => {}) },
}));

const control = () => new ScmControlService(serverDB);

const baseRow = {
  headSha: 'c'.repeat(40),
  number: 5,
  provider: 'github' as const,
  repoFullName: 'arvinxx/sandbox',
  state: 'open' as const,
  url: 'https://github.com/arvinxx/sandbox/pull/5',
  userId,
};

const changeRequestEvent = (kind: 'merged' | 'opened') =>
  ({
    changeRequest: baseRow,
    installationId: '90001',
    kind,
    type: 'change_request',
  }) as const;

const checksEvent: Extract<ScmInboundEvent, { type: 'checks' }> = {
  checks: [],
  headSha: baseRow.headSha,
  installationId: '90001',
  numbers: [5],
  repoFullName: baseRow.repoFullName,
  type: 'checks',
};

const reviewEvent = (login: string, association: ScmActorAssociation = 'collaborator') =>
  ({
    actor: { association, externalId: '1', login },
    installationId: '90001',
    kind: 'review_commented',
    number: 5,
    repoFullName: baseRow.repoFullName,
    review: { externalId: 'r1' },
    type: 'review',
  }) as const;

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  mocks.execAgent.mockResolvedValue({ operationId: 'op_1' });
  mocks.redisSet.mockResolvedValue('OK');
  mocks.jobLog.mockResolvedValue('npm ERR! test failed\n');
  mocks.reviewFeedback.mockResolvedValue([]);
  mocks.postComment.mockResolvedValue('c-1');
  mocks.updateComment.mockResolvedValue(true);
});

afterEach(async () => {
  await serverDB.delete(scmWebhookDeliveries);
  await serverDB.delete(users);
  vi.clearAllMocks();
});

const createTopic = async () => {
  await serverDB.insert(agents).values({ id: 'agt_control', slug: 'agt_control', userId });
  const [topic] = await serverDB
    .insert(topics)
    .values({ agentId: 'agt_control', title: 'PR topic', userId })
    .returning();
  return topic;
};

describe('ScmControlService — merge', () => {
  it('accepts the linked acceptance, stamps the round, and flips the Work', async () => {
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({ status: 'verifying', subjectId: 's', subjectType: 'standalone', userId })
      .returning();
    const [run] = await serverDB
      .insert(verifyRuns)
      .values({ acceptanceId: acceptance.id, roundIndex: 1, userId })
      .returning();
    const [work] = await serverDB
      .insert(works)
      .values({
        resourceId: 'arvinxx/sandbox#5',
        resourceType: 'github_pull_request',
        status: 'open',
        toolIdentifier: 'lobe-local-system',
        toolName: 'runCommand',
        type: 'external',
        userId,
        visibility: 'private',
      })
      .returning();
    const row = await ScmChangeRequestModel.upsert(serverDB, {
      ...baseRow,
      links: { acceptanceId: acceptance.id, workId: work.id },
      mergedByExternalId: '42',
      state: 'merged',
    });

    const outcome = await control().handle({
      event: changeRequestEvent('merged'),
      kind: 'merged',
      row,
    });
    expect(outcome).toEqual({ acceptanceId: acceptance.id, outcome: 'accepted' });

    const [after] = await serverDB
      .select()
      .from(acceptances)
      .where(eq(acceptances.id, acceptance.id));
    expect(after.status).toBe('accepted');
    expect(after.completedAt).not.toBeNull();

    const [decided] = await serverDB.select().from(verifyRuns).where(eq(verifyRuns.id, run.id));
    expect(decided.userDecision).toBe('accept');
    expect(decided.decisionDetail).toMatchObject({
      changeRequest: { number: 5, repoFullName: 'arvinxx/sandbox' },
      source: 'scm_merge',
    });

    const [flipped] = await serverDB.select().from(works).where(eq(works.id, work.id));
    expect(flipped.status).toBe('merged');
  });

  it('waits for every linked pull request of a stack before accepting', async () => {
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({ subjectId: 's', subjectType: 'standalone', userId })
      .returning();
    const merged = await ScmChangeRequestModel.upsert(serverDB, {
      ...baseRow,
      links: { acceptanceId: acceptance.id },
      state: 'merged',
    });
    await ScmChangeRequestModel.upsert(serverDB, {
      ...baseRow,
      links: { acceptanceId: acceptance.id },
      number: 6,
      url: 'https://github.com/arvinxx/sandbox/pull/6',
    });

    const outcome = await control().handle({
      event: changeRequestEvent('merged'),
      kind: 'merged',
      row: merged,
    });
    expect(outcome).toMatchObject({
      outcome: 'skipped',
      detail: expect.stringContaining('still open'),
    });
    const [after] = await serverDB
      .select()
      .from(acceptances)
      .where(eq(acceptances.id, acceptance.id));
    expect(after.status).toBe('pending');
  });
});

describe('ScmControlService — wake', () => {
  it('wakes the agent of the linked conversation with the failing check and its log', async () => {
    const topic = await createTopic();
    const installation = await ScmInstallationModel.bind(serverDB, {
      accountExternalId: '1',
      accountLogin: 'arvinxx',
      accountType: 'user',
      installationId: '90001',
      provider: 'github',
      repositorySelection: 'all',
      userId,
    });
    const row = await ScmChangeRequestModel.upsert(serverDB, {
      ...baseRow,
      headRef: 'feat/x',
      links: { installationId: installation.id, topicId: topic.id },
    });
    const withChecks = await ScmChangeRequestModel.applyChecks(serverDB, row.id, {
      checks: [
        {
          conclusion: 'failure',
          externalId: 'check_run:777',
          name: 'Test',
          status: 'completed',
          url: 'https://github.com/arvinxx/sandbox/actions/runs/1/job/777',
        },
      ],
      headSha: baseRow.headSha,
    });

    const outcome = await control().handle({
      event: checksEvent,
      kind: 'ci_failed',
      row: withChecks!.row,
    });
    expect(outcome).toEqual({ operationId: 'op_1', outcome: 'woken', reason: 'ci_failed' });

    expect(mocks.jobLog).toHaveBeenCalledWith({
      installationId: '90001',
      jobId: '777',
      repoFullName: 'arvinxx/sandbox',
    });
    const call = mocks.execAgent.mock.calls[0][0];
    expect(call).toMatchObject({
      agentId: 'agt_control',
      appContext: { topicId: topic.id },
      externalOrigin: {
        kind: 'ci_failed',
        label: 'arvinxx/sandbox#5',
        provider: 'github',
        resourceId: row.id,
        url: baseRow.url,
      },
      steer: false,
      trigger: 'scm',
      userInterventionConfig: { approvalMode: 'headless' },
    });
    expect(call.prompt).toContain('repo="arvinxx/sandbox"');
    expect(call.prompt).toContain('<check conclusion="failure" name="Test"');
    expect(call.prompt).toContain('npm ERR! test failed');
    expect(call.prompt).toContain('branch="feat/x"');

    const after = await ScmChangeRequestModel.findById(serverDB, row.id);
    expect(after?.wakeCount).toBe(1);
    expect(after?.metadata.lastWake?.reason).toBe('ci_failed');
  });

  it('steers instead of starting a new turn when the conversation is running', async () => {
    const topic = await createTopic();
    await serverDB
      .update(topics)
      .set({
        metadata: { runningOperation: { assistantMessageId: 'm', operationId: 'op_0' } } as any,
      })
      .where(eq(topics.id, topic.id));
    const row = await ScmChangeRequestModel.upsert(serverDB, {
      ...baseRow,
      links: { topicId: topic.id },
    });

    await control().handle({
      event: reviewEvent('reviewer'),
      kind: 'review_changes_requested',
      row,
    });
    expect(mocks.execAgent.mock.calls[0][0]).toMatchObject({ steer: true });
    expect(mocks.execAgent.mock.calls[0][0].prompt).toContain('requested changes');
  });

  it('skips drafts, unlinked rows, self comments, debounced bursts, and the wake cap', async () => {
    const topic = await createTopic();
    const linked = await ScmChangeRequestModel.upsert(serverDB, {
      ...baseRow,
      authorExternalLogin: 'the-agent',
      links: { topicId: topic.id },
    });

    expect(
      await control().handle({
        event: checksEvent,
        kind: 'ci_failed',
        row: { ...linked, isDraft: true },
      }),
    ).toMatchObject({ outcome: 'skipped', detail: 'draft pull request' });

    expect(
      await control().handle({
        event: checksEvent,
        kind: 'ci_failed',
        row: { ...linked, topicId: null },
      }),
    ).toMatchObject({ outcome: 'skipped', detail: 'no linked conversation' });

    expect(
      await control().handle({
        event: checksEvent,
        kind: 'ci_failed',
        row: { ...linked, state: 'merged' },
      }),
    ).toMatchObject({ outcome: 'skipped', detail: 'pull request is merged' });

    expect(
      await control().handle({
        event: reviewEvent('the-agent'),
        kind: 'review_commented',
        row: linked,
      }),
    ).toMatchObject({ outcome: 'skipped', detail: 'self comment' });

    expect(
      await control().handle({
        event: checksEvent,
        kind: 'ci_failed',
        row: { ...linked, wakeCount: SCM_MAX_WAKES },
      }),
    ).toMatchObject({ outcome: 'skipped', detail: expect.stringContaining('wake cap') });

    expect(mocks.execAgent).not.toHaveBeenCalled();
  });

  it('ignores review feedback from someone the repository does not trust', async () => {
    const topic = await createTopic();
    const row = await ScmChangeRequestModel.upsert(serverDB, {
      ...baseRow,
      links: { topicId: topic.id },
    });

    for (const association of ['none', 'contributor', 'unknown'] as const) {
      expect(
        await control().handle({
          event: reviewEvent('drive-by', association),
          kind: 'review_changes_requested',
          row,
        }),
      ).toMatchObject({ detail: `reviewer is ${association}`, outcome: 'skipped' });
    }
    expect(mocks.execAgent).not.toHaveBeenCalled();

    // A collaborator's feedback still wakes the agent.
    expect(
      await control().handle({
        event: reviewEvent('maintainer', 'member'),
        kind: 'review_changes_requested',
        row,
      }),
    ).toMatchObject({ outcome: 'woken' });
  });

  it('delivers a failure the debounce window swallowed on the next event', async () => {
    const topic = await createTopic();
    const row = await ScmChangeRequestModel.upsert(serverDB, {
      ...baseRow,
      links: { topicId: topic.id },
    });

    // Second job of the burst: the window is still held by the first wake,
    // so nothing is sent — not by this event, and not by the flush either.
    mocks.redisSet.mockResolvedValue(null);
    expect(await control().handle({ event: checksEvent, kind: 'ci_failed', row })).toMatchObject({
      detail: 'debounced',
      outcome: 'skipped',
    });
    expect(mocks.execAgent).not.toHaveBeenCalled();
    expect(
      (await ScmChangeRequestModel.findById(serverDB, row.id))?.metadata.pendingWake?.reason,
    ).toBe('ci_failed');

    // Once the window frees up, any later delivery carries it and the
    // marker is cleared.
    mocks.redisSet.mockResolvedValue('OK');
    const fresh = (await ScmChangeRequestModel.findById(serverDB, row.id))!;
    await control().handle({
      event: changeRequestEvent('opened'),
      kind: 'synchronized',
      row: fresh,
    });
    expect(mocks.execAgent).toHaveBeenCalledTimes(1);
    expect(
      (await ScmChangeRequestModel.findById(serverDB, row.id))?.metadata.pendingWake,
    ).toBeUndefined();
  });

  it('respects the automation switches of the user who connected the installation', async () => {
    const topic = await createTopic();
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({ subjectId: 's', subjectType: 'standalone', userId })
      .returning();
    const row = await ScmChangeRequestModel.upsert(serverDB, {
      ...baseRow,
      links: { acceptanceId: acceptance.id, topicId: topic.id },
    });
    await serverDB
      .update(users)
      .set({
        preference: {
          integration: { github: { acceptOnMerge: false, wakeOnCiFailure: false } },
        } as any,
      })
      .where(eq(users.id, userId));

    expect(await control().handle({ event: checksEvent, kind: 'ci_failed', row })).toMatchObject({
      outcome: 'skipped',
      detail: 'wakeOnCiFailure is off',
    });
    expect(
      await control().handle({
        event: changeRequestEvent('merged'),
        kind: 'merged',
        row: { ...row, state: 'merged' },
      }),
    ).toMatchObject({ outcome: 'skipped', detail: 'acceptOnMerge is off' });
    expect(mocks.execAgent).not.toHaveBeenCalled();
    const [after] = await serverDB
      .select()
      .from(acceptances)
      .where(eq(acceptances.id, acceptance.id));
    expect(after.status).toBe('pending');

    // wakeOnReview was left unset, so review feedback still wakes the agent.
    expect(
      await control().handle({ event: reviewEvent('reviewer'), kind: 'review_commented', row }),
    ).toMatchObject({ outcome: 'woken' });
  });

  it('drops a pending wake when the automation was switched off in between', async () => {
    const topic = await createTopic();
    const row = await ScmChangeRequestModel.upsert(serverDB, {
      ...baseRow,
      links: { topicId: topic.id },
    });

    // A burst leaves a marker behind.
    mocks.redisSet.mockResolvedValue(null);
    await control().handle({ event: checksEvent, kind: 'ci_failed', row });
    expect(
      (await ScmChangeRequestModel.findById(serverDB, row.id))?.metadata.pendingWake?.reason,
    ).toBe('ci_failed');

    // The user turns CI notifications off before the next delivery. The
    // marker must not outlive that decision.
    await serverDB
      .update(users)
      .set({ preference: { integration: { github: { wakeOnCiFailure: false } } } as any })
      .where(eq(users.id, userId));
    mocks.redisSet.mockResolvedValue('OK');

    const fresh = (await ScmChangeRequestModel.findById(serverDB, row.id))!;
    await control().handle({
      event: changeRequestEvent('opened'),
      kind: 'synchronized',
      row: fresh,
    });

    expect(mocks.execAgent).not.toHaveBeenCalled();
    const after = await ScmChangeRequestModel.findById(serverDB, row.id);
    expect(after?.metadata.pendingWake).toBeUndefined();
    expect(after?.wakeCount).toBe(0);
  });

  it('holds the wake cap when two deliveries race on the same stale row', async () => {
    const topic = await createTopic();
    const row = await ScmChangeRequestModel.upsert(serverDB, {
      ...baseRow,
      links: { topicId: topic.id },
    });
    // One slot left, and both deliveries hold the snapshot that says so —
    // which is what a Redis-less deployment looks like, since nothing
    // debounces them.
    await ScmChangeRequestModel.reserveWake(serverDB, row.id, SCM_MAX_WAKES, 'ci_failed');
    await ScmChangeRequestModel.reserveWake(serverDB, row.id, SCM_MAX_WAKES, 'ci_failed');
    const stale = { ...row, wakeCount: SCM_MAX_WAKES - 1 };

    const outcomes = await Promise.all([
      control().handle({ event: checksEvent, kind: 'ci_failed', row: stale }),
      control().handle({ event: checksEvent, kind: 'ci_failed', row: stale }),
    ]);

    expect(outcomes.filter((o) => o.outcome === 'woken')).toHaveLength(1);
    expect(mocks.execAgent).toHaveBeenCalledTimes(1);
    expect((await ScmChangeRequestModel.findById(serverDB, row.id))?.wakeCount).toBe(SCM_MAX_WAKES);
  });

  it('reports a failed wake without counting it', async () => {
    const topic = await createTopic();
    const row = await ScmChangeRequestModel.upsert(serverDB, {
      ...baseRow,
      links: { topicId: topic.id },
    });
    mocks.execAgent.mockRejectedValueOnce(new Error('topic busy'));

    expect(await control().handle({ event: checksEvent, kind: 'ci_failed', row })).toMatchObject({
      outcome: 'skipped',
      detail: 'wake failed: topic busy',
    });
    expect((await ScmChangeRequestModel.findById(serverDB, row.id))?.wakeCount).toBe(0);
  });
});

describe('ScmControlService — the tracking comment in GitHub', () => {
  const bindAndOpen = async (extra: Record<string, unknown>) => {
    const topic = await createTopic();
    const installation = await ScmInstallationModel.bind(serverDB, {
      accountExternalId: '1',
      accountLogin: 'arvinxx',
      accountType: 'user',
      installationId: '90001',
      provider: 'github',
      repositorySelection: 'all',
      userId,
    });
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({ status: 'delivered', subjectId: 's', subjectType: 'standalone', userId })
      .returning();
    return ScmChangeRequestModel.upsert(serverDB, {
      ...baseRow,
      links: { acceptanceId: acceptance.id, installationId: installation.id, topicId: topic.id },
      ...extra,
    });
  };

  it('posts one comment with a hidden marker and a status table, then rewrites it in place', async () => {
    const row = await bindAndOpen({ metadata: { repoPrivate: true } });

    const first = await control().handle({
      event: changeRequestEvent('opened'),
      kind: 'opened',
      row,
    });
    expect(first).toEqual({ commentId: 'c-1', outcome: 'commented', updated: false });
    expect(mocks.postComment).toHaveBeenCalledTimes(1);
    const body = mocks.postComment.mock.calls[0][0].body as string;
    expect(parseTrackingMarker(body)).toEqual({
      acceptanceId: row.acceptanceId,
      changeRequestId: row.id,
      provider: 'github',
      topicId: row.topicId,
      v: 1,
    });
    expect(body).toContain(`https://app.test/acceptance/${row.acceptanceId}`);
    expect(body).toContain(`https://app.test/agent/agt_control/${row.topicId}`);
    expect(body).toContain('| 🟡 Delivered |');
    expect(body).toContain('[PR topic ↗︎]');

    const stored = await ScmChangeRequestModel.findById(serverDB, row.id);
    expect(stored?.metadata.lobehubCommentId).toBe('c-1');

    // The next event rewrites the same comment instead of posting again.
    const again = await control().handle({
      event: changeRequestEvent('opened'),
      kind: 'synchronized',
      row: stored!,
    });
    expect(again).toEqual({ commentId: 'c-1', outcome: 'commented', updated: true });
    expect(mocks.postComment).toHaveBeenCalledTimes(1);
    expect(mocks.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: 'c-1', installationId: '90001' }),
    );

    // A concurrent handler still holding the pre-comment row is steered to
    // the update path by the fresh read even when its claim goes through.
    const stale = await control().handle({
      event: changeRequestEvent('opened'),
      kind: 'synchronized',
      row,
    });
    expect(stale).toMatchObject({ outcome: 'commented', updated: true });
    expect(mocks.postComment).toHaveBeenCalledTimes(1);

    // And when the claim itself is lost, nothing is posted either.
    mocks.redisSet.mockResolvedValueOnce(null);
    const unclaimed = await ScmChangeRequestModel.upsert(serverDB, {
      ...baseRow,
      links: { acceptanceId: row.acceptanceId, installationId: row.installationId },
      metadata: { repoPrivate: true },
      number: 6,
      url: 'https://github.com/arvinxx/sandbox/pull/6',
    });
    expect(
      await control().handle({
        event: changeRequestEvent('opened'),
        kind: 'opened',
        row: unclaimed,
      }),
    ).toMatchObject({ outcome: 'skipped', detail: 'comment already in flight' });
    expect(mocks.postComment).toHaveBeenCalledTimes(1);
  });

  it('reflects the merge and the notifications in the comment', async () => {
    const row = await bindAndOpen({ metadata: { repoPrivate: true } });
    await control().handle({ event: changeRequestEvent('opened'), kind: 'opened', row });
    const stored = (await ScmChangeRequestModel.findById(serverDB, row.id))!;

    await control().handle({ event: checksEvent, kind: 'ci_failed', row: stored });
    expect(mocks.updateComment).toHaveBeenCalledTimes(1);
    expect(mocks.updateComment.mock.calls[0][0].body).toContain('| 1/3 · CI failed |');

    // The ingest half lands the merge on the row before the control half runs.
    const merged = await ScmChangeRequestModel.upsert(serverDB, { ...baseRow, state: 'merged' });
    await control().handle({ event: changeRequestEvent('merged'), kind: 'merged', row: merged });
    expect(mocks.updateComment).toHaveBeenCalledTimes(2);
    expect(mocks.updateComment.mock.calls[1][0].body).toContain('| ✅ Accepted |');
  });

  it('stays quiet on public repositories unless opted in, and without links', async () => {
    const publicRow = await bindAndOpen({ metadata: { repoPrivate: false } });
    expect(
      await control().handle({
        event: changeRequestEvent('opened'),
        kind: 'opened',
        row: publicRow,
      }),
    ).toMatchObject({ outcome: 'skipped', detail: 'commentOnPublicRepositories is off' });

    await serverDB
      .update(users)
      .set({ preference: { integration: { github: { commentOnPublicRepositories: true } } } })
      .where(eq(users.id, userId));
    expect(
      await control().handle({
        event: changeRequestEvent('opened'),
        kind: 'opened',
        row: publicRow,
      }),
    ).toMatchObject({ outcome: 'commented' });

    const unlinked = await ScmChangeRequestModel.upsert(serverDB, {
      ...baseRow,
      metadata: { repoPrivate: true },
      number: 9,
      url: 'https://github.com/arvinxx/sandbox/pull/9',
    });
    expect(
      await control().handle({
        event: changeRequestEvent('opened'),
        kind: 'opened',
        row: unlinked,
      }),
    ).toMatchObject({ outcome: 'skipped', detail: 'no links to share' });
  });
});
