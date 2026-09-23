// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScmChangeRequestModel, ScmInstallationModel } from '@/database/models/scm';
import {
  acceptances,
  scmIdentities,
  scmWebhookDeliveries,
  topics,
  users,
  works,
  workspaces,
} from '@/database/schemas';

import * as fx from '../github/__tests__/fixtures';
import { normalizeGitHubEvent } from '../github/normalize';
import { ScmIngestService } from '../ScmIngestService';

const serverDB = await getTestDB();
const userId = 'scm-ingest-user';
const acceptanceId = '0f1e2d3c-4b5a-4c6d-8e9f-0a1b2c3d4e5f';

const bindInstallation = () =>
  ScmInstallationModel.bind(serverDB, {
    accountExternalId: '1',
    accountLogin: 'lobehub',
    accountType: 'organization',
    installationId: String(fx.installation.id),
    provider: 'github',
    repositorySelection: 'all',
    userId,
  });

const ingest = (
  event: string,
  payload: Record<string, unknown>,
  service = new ScmIngestService(serverDB),
) => service.apply(normalizeGitHubEvent(event, payload));

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(scmWebhookDeliveries);
  await serverDB.delete(users);
});

describe('ScmIngestService', () => {
  it('skips events from an installation nobody has connected', async () => {
    expect(await ingest('pull_request', fx.pullRequestEvent('opened'))).toMatchObject({
      status: 'skipped',
    });
    expect(await ingest('installation', fx.installationEvent('created'))).toMatchObject({
      status: 'skipped',
    });
    expect(
      await ScmChangeRequestModel.findByIdentity(serverDB, 'github', 'lobehub/lobehub', 19_719),
    ).toBeNull();
  });

  it('tracks a pull request through open, CI failure, review, and merge', async () => {
    const installation = await bindInstallation();
    await serverDB
      .insert(acceptances)
      .values({ id: acceptanceId, subjectId: 's', subjectType: 'standalone', userId });

    const hook = vi.fn(async () => {});
    const service = new ScmIngestService(serverDB);
    service.onChangeRequestEvent = hook;

    // opened → row scoped to the installation, linked to the acceptance from the body
    expect(await ingest('pull_request', fx.pullRequestEvent('opened'), service)).toMatchObject({
      status: 'processed',
    });
    let row = await ScmChangeRequestModel.findByIdentity(
      serverDB,
      'github',
      'lobehub/lobehub',
      19_719,
    );
    expect(row).toMatchObject({
      acceptanceId,
      installationId: installation.id,
      lastEventKind: 'opened',
      state: 'open',
      userId,
    });
    expect(hook).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'opened' }));

    // failing check_run → rollup failure + ci_failed
    expect(await ingest('check_run', fx.checkRunEvent(), service)).toMatchObject({
      status: 'processed',
    });
    row = await ScmChangeRequestModel.findById(serverDB, row!.id);
    expect(row).toMatchObject({ ciStatus: 'failure', lastEventKind: 'ci_failed' });
    expect(row?.checks?.[0]).toMatchObject({ name: 'Test Packages' });
    expect(hook).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'ci_failed' }));

    // a second, green check_run does not flip the rollup while the failure stands
    hook.mockClear();
    await ingest(
      'check_run',
      fx.checkRunEvent({ conclusion: 'success', id: 3, name: 'Lint' }),
      service,
    );
    row = await ScmChangeRequestModel.findById(serverDB, row!.id);
    expect(row?.ciStatus).toBe('failure');
    expect(row?.checks).toHaveLength(2);
    expect(hook).not.toHaveBeenCalled();

    // review changes requested
    await ingest('pull_request_review', fx.reviewEvent('changes_requested'), service);
    row = await ScmChangeRequestModel.findById(serverDB, row!.id);
    expect(row).toMatchObject({
      lastEventKind: 'review_changes_requested',
      reviewDecision: 'changes_requested',
    });

    // the same review dismissed: GitHub invalidated the verdict
    await ingest(
      'pull_request_review',
      { ...fx.reviewEvent('dismissed'), action: 'dismissed' },
      service,
    );
    row = await ScmChangeRequestModel.findById(serverDB, row!.id);
    expect(row).toMatchObject({ lastEventKind: 'review_dismissed', reviewDecision: null });

    // merged
    await ingest(
      'pull_request',
      fx.pullRequestEvent('closed', {
        merged: true,
        merged_at: '2026-09-20T07:00:00Z',
        merged_by: { id: 42, login: 'arvinxx' },
        state: 'closed',
      }),
      service,
    );
    row = await ScmChangeRequestModel.findById(serverDB, row!.id);
    expect(row).toMatchObject({
      lastEventKind: 'merged',
      mergedByExternalId: '42',
      state: 'merged',
    });
    expect(hook).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'merged' }));
  });

  it('drops a review the same reviewer has already superseded', async () => {
    const hook = vi.fn();
    const service = new ScmIngestService(serverDB);
    service.onChangeRequestEvent = hook;

    await bindInstallation();
    await ingest('pull_request', fx.pullRequestEvent('opened'), service);

    // The approval lands first; the older changes-request arrives after.
    await ingest(
      'pull_request_review',
      {
        ...fx.reviewEvent('approved'),
        review: { ...fx.reviewEvent('approved').review, submitted_at: '2026-09-20T12:00:00Z' },
      },
      service,
    );
    hook.mockClear();

    expect(
      await ingest(
        'pull_request_review',
        {
          ...fx.reviewEvent('changes_requested'),
          review: {
            ...fx.reviewEvent('changes_requested').review,
            submitted_at: '2026-09-20T09:00:00Z',
          },
        },
        service,
      ),
    ).toMatchObject({ status: 'skipped' });

    const row = await ScmChangeRequestModel.findByIdentity(
      serverDB,
      'github',
      'lobehub/lobehub',
      19_719,
    );
    // Neither the verdict, nor the event marker, nor the control half moved.
    expect(row).toMatchObject({ lastEventKind: 'review_approved', reviewDecision: 'approved' });
    expect(hook).not.toHaveBeenCalled();
  });

  it('resets CI on a new push and ignores late results for the old commit', async () => {
    await bindInstallation();
    await ingest('pull_request', fx.pullRequestEvent('opened'));
    await ingest('check_run', fx.checkRunEvent());

    const sha2 = 'b'.repeat(40);
    await ingest(
      'pull_request',
      fx.pullRequestEvent('synchronize', { head: { ref: 'x', sha: sha2 } }),
    );
    let row = await ScmChangeRequestModel.findByIdentity(
      serverDB,
      'github',
      'lobehub/lobehub',
      19_719,
    );
    expect(row).toMatchObject({ checks: null, ciStatus: null, headSha: sha2 });

    // late result for the old sha, no PR numbers attached (fork-style)
    expect(await ingest('check_run', fx.checkRunEvent({ pull_requests: [] }))).toMatchObject({
      status: 'skipped',
    });

    // result for the new sha, resolved by sha
    expect(
      await ingest(
        'check_run',
        fx.checkRunEvent({ conclusion: 'success', head_sha: sha2, pull_requests: [] }),
      ),
    ).toMatchObject({ status: 'processed' });
    row = await ScmChangeRequestModel.findById(serverDB, row!.id);
    expect(row).toMatchObject({ ciStatus: 'success', lastEventKind: 'ci_passed' });
  });

  it('does not classify a redelivered failure that lost to a newer success', async () => {
    await bindInstallation();
    await ingest('pull_request', fx.pullRequestEvent('opened'));

    // The job was rerun and went green.
    await ingest(
      'check_run',
      fx.checkRunEvent({ completed_at: '2026-09-20T07:00:00Z', conclusion: 'success', id: 9 }),
    );
    let row = await ScmChangeRequestModel.findByIdentity(
      serverDB,
      'github',
      'lobehub/lobehub',
      19_719,
    );
    expect(row).toMatchObject({ ciStatus: 'success', lastEventKind: 'ci_passed' });

    // The original failure is redelivered afterwards — we use redelivery as
    // the recovery path, so this is ordinary traffic. It loses to the newer
    // result, and must not be classified as a fresh failure: the row is
    // green, so the wake would carry nothing and still spend a slot.
    await ingest('check_run', fx.checkRunEvent());
    row = await ScmChangeRequestModel.findById(serverDB, row!.id);
    expect(row).toMatchObject({ ciStatus: 'success', lastEventKind: 'ci_passed' });
  });

  it("routes a pull request to the author's own conversation, not the installation's tenant", async () => {
    // The org installed the App on its workspace; the pull request was
    // opened by a member whose agent lives in their personal scope.
    const orgOwner = 'scm-ingest-org-owner';
    await serverDB.insert(users).values({ id: orgOwner });
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'ws', primaryOwnerId: orgOwner, slug: 'scm-ingest-ws' })
      .returning();
    await ScmInstallationModel.bind(serverDB, {
      accountExternalId: '1',
      accountLogin: 'lobehub',
      accountType: 'organization',
      installationId: String(fx.installation.id),
      provider: 'github',
      repositorySelection: 'all',
      userId: orgOwner,
      workspaceId: workspace.id,
    });

    // `pullRequest.user.id` is 42 in the fixture; that account is linked to
    // our member, who is not in the workspace at all.
    await serverDB.insert(scmIdentities).values({
      externalLogin: 'arvinxx',
      externalUserId: '42',
      provider: 'github',
      userId,
    });
    const [topic] = await serverDB.insert(topics).values({ title: 'PR topic', userId }).returning();
    await serverDB.insert(works).values({
      originTopicId: topic.id,
      resourceId: 'lobehub/lobehub#19719',
      resourceType: 'github_pull_request',
      toolIdentifier: 'lobe-local-system',
      toolName: 'runCommand',
      type: 'external',
      userId,
      visibility: 'private',
    });

    expect(await ingest('pull_request', fx.pullRequestEvent('opened'))).toMatchObject({
      status: 'processed',
    });

    const row = await ScmChangeRequestModel.findByIdentity(
      serverDB,
      'github',
      'lobehub/lobehub',
      19_719,
    );
    // The conversation is found, and the row says where to look for it.
    expect(row).toMatchObject({ topicId: topic.id, userId, workspaceId: null });

    // The workspace still sees the pull request: it owns the installation.
    const seen = await ScmChangeRequestModel.listByScope(serverDB, {
      userId: orgOwner,
      workspaceId: workspace.id,
    });
    expect(seen.map((item) => item.id)).toContain(row!.id);

    await serverDB.delete(users).where(eq(users.id, orgOwner));
  });

  it('maintains the installation from lifecycle events', async () => {
    const installation = await bindInstallation();

    await ingest('installation_repositories', fx.installationRepositoriesEvent());
    let fresh = await ScmInstallationModel.findById(serverDB, installation.id);
    expect(fresh?.repositories).toEqual([
      { externalId: '601000002', fullName: 'lobehub/lobehub-cloud', private: true },
    ]);

    await ingest('installation', fx.installationEvent('suspend'));
    fresh = await ScmInstallationModel.findById(serverDB, installation.id);
    expect(fresh?.suspendedAt).not.toBeNull();

    await ingest('installation', fx.installationEvent('deleted'));
    fresh = await ScmInstallationModel.findById(serverDB, installation.id);
    expect(fresh?.revokedAt).not.toBeNull();

    // revoked → events for it are skipped
    expect(await ingest('pull_request', fx.pullRequestEvent('opened'))).toMatchObject({
      status: 'skipped',
    });
  });
});
