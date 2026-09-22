import { describe, expect, it } from 'vitest';

import { describeGitHubDelivery, normalizeGitHubEvent } from '../normalize';
import * as fx from './fixtures';

describe('normalizeGitHubEvent', () => {
  describe('pull_request', () => {
    it('maps opened to a change_request event with the body and snapshot', () => {
      const event = normalizeGitHubEvent('pull_request', fx.pullRequestEvent('opened'));

      expect(event).toMatchObject({
        actor: { externalId: '42', login: 'arvinxx' },
        installationId: '90001',
        kind: 'opened',
        type: 'change_request',
      });
      if (event.type !== 'change_request') throw new Error('unreachable');
      expect(event.body).toContain('/acceptance/0f1e2d3c');
      expect(event.changeRequest).toMatchObject({
        baseRef: 'canary',
        headRef: 'feat/scm-github-app',
        headSha: 'a'.repeat(40),
        isDraft: false,
        mergeStateStatus: 'CLEAN',
        metadata: { mergeable: 'true' },
        number: 19_719,
        provider: 'github',
        repoFullName: 'lobehub/lobehub',
        state: 'open',
        url: 'https://github.com/lobehub/lobehub/pull/19719',
      });
      expect(event.occurredAt).toEqual(new Date('2026-09-20T06:00:00Z'));
    });

    it('distinguishes merged from closed-without-merge', () => {
      const merged = normalizeGitHubEvent(
        'pull_request',
        fx.pullRequestEvent('closed', {
          merged: true,
          merged_at: '2026-09-20T07:00:00Z',
          merged_by: { id: 42, login: 'arvinxx' },
          state: 'closed',
        }),
      );
      expect(merged).toMatchObject({
        changeRequest: {
          mergedAt: new Date('2026-09-20T07:00:00Z'),
          mergedByExternalId: '42',
          state: 'merged',
        },
        kind: 'merged',
      });

      const closed = normalizeGitHubEvent(
        'pull_request',
        fx.pullRequestEvent('closed', { closed_at: '2026-09-20T07:00:00Z', state: 'closed' }),
      );
      expect(closed).toMatchObject({ changeRequest: { state: 'closed' }, kind: 'closed' });
    });

    it('maps synchronize / ready_for_review / edited and ignores unknown actions', () => {
      expect(
        normalizeGitHubEvent('pull_request', fx.pullRequestEvent('synchronize')),
      ).toMatchObject({
        kind: 'synchronized',
      });
      expect(
        normalizeGitHubEvent('pull_request', fx.pullRequestEvent('ready_for_review')),
      ).toMatchObject({ kind: 'ready_for_review' });
      expect(normalizeGitHubEvent('pull_request', fx.pullRequestEvent('edited'))).toMatchObject({
        kind: 'synchronized',
      });
      expect(normalizeGitHubEvent('pull_request', fx.pullRequestEvent('labeled'))).toMatchObject({
        type: 'ignored',
      });
    });
  });

  describe('reviews', () => {
    it('maps a submitted review by state', () => {
      expect(
        normalizeGitHubEvent('pull_request_review', fx.reviewEvent('changes_requested')),
      ).toMatchObject({
        actor: { externalId: '77' },
        kind: 'review_changes_requested',
        number: 19_719,
        review: { body: 'Please split the handler.', externalId: '7' },
        type: 'review',
      });
      expect(normalizeGitHubEvent('pull_request_review', fx.reviewEvent('APPROVED'))).toMatchObject(
        {
          kind: 'review_approved',
        },
      );
      expect(
        normalizeGitHubEvent('pull_request_review', fx.reviewEvent('commented')),
      ).toMatchObject({
        kind: 'review_commented',
      });
      // `dismissed` arrives as an action, not a review state: GitHub has
      // invalidated the verdict, so it has to reach the ingest path.
      expect(
        normalizeGitHubEvent('pull_request_review', {
          ...fx.reviewEvent('dismissed'),
          action: 'dismissed',
        }),
      ).toMatchObject({ kind: 'review_dismissed', occurredAt: undefined, type: 'review' });
      expect(
        normalizeGitHubEvent('pull_request_review', {
          ...fx.reviewEvent('approved'),
          action: 'edited',
        }),
      ).toMatchObject({ type: 'ignored' });
    });

    it('maps an inline review comment with its file location', () => {
      expect(
        normalizeGitHubEvent('pull_request_review_comment', fx.reviewCommentEvent()),
      ).toMatchObject({
        kind: 'review_commented',
        review: {
          externalId: 'comment:9',
          line: 42,
          path: 'apps/server/src/services/scm/ScmIngestService.ts',
        },
        type: 'review',
      });
    });
  });

  describe('checks', () => {
    it('maps a check_run to one check keyed by run id, with the PR numbers attached', () => {
      const event = normalizeGitHubEvent('check_run', fx.checkRunEvent());
      expect(event).toEqual({
        checks: [
          {
            completedAt: '2026-09-20T06:05:00Z',
            conclusion: 'failure',
            externalId: 'check_run:2',
            name: 'Test Packages',
            reportedAt: '2026-09-20T06:05:00Z',
            startedAt: '2026-09-20T06:01:00Z',
            status: 'completed',
            url: 'https://github.com/lobehub/lobehub/runs/2',
          },
        ],
        headSha: 'a'.repeat(40),
        installationId: '90001',
        numbers: [19_719],
        repoFullName: 'lobehub/lobehub',
        type: 'checks',
      });
    });

    it('keeps an in-progress check_run pending with no conclusion', () => {
      const event = normalizeGitHubEvent(
        'check_run',
        fx.checkRunEvent({
          completed_at: null,
          conclusion: null,
          pull_requests: [],
          status: 'in_progress',
        }),
      );
      expect(event).toMatchObject({
        checks: [{ conclusion: undefined, status: 'in_progress' }],
        numbers: [],
      });
    });

    it('folds a commit status into the check set by context', () => {
      expect(normalizeGitHubEvent('status', fx.statusEvent('failure'))).toMatchObject({
        checks: [{ conclusion: 'failure', externalId: 'status:ci/circleci', status: 'completed' }],
        type: 'checks',
      });
      expect(normalizeGitHubEvent('status', fx.statusEvent('pending'))).toMatchObject({
        checks: [{ conclusion: undefined, status: 'in_progress' }],
      });
    });

    it('ignores the aggregate events that duplicate check_run', () => {
      expect(normalizeGitHubEvent('check_suite', { action: 'completed' })).toMatchObject({
        type: 'ignored',
      });
      expect(normalizeGitHubEvent('workflow_run', { action: 'completed' })).toMatchObject({
        type: 'ignored',
      });
    });
  });

  describe('installations', () => {
    it('maps installation lifecycle with the account snapshot and repositories', () => {
      const event = normalizeGitHubEvent('installation', fx.installationEvent('created'));
      expect(event).toMatchObject({
        action: 'created',
        installation: {
          accountExternalId: '1',
          accountLogin: 'lobehub',
          accountType: 'organization',
          installationId: '90001',
          metadata: { events: ['pull_request', 'check_run'], permissions: { checks: 'write' } },
          provider: 'github',
          repositories: [{ externalId: '601000001', fullName: 'lobehub/lobehub', private: false }],
          repositorySelection: 'selected',
        },
        type: 'installation',
      });
    });

    it('maps repository adds and removes', () => {
      expect(
        normalizeGitHubEvent('installation_repositories', fx.installationRepositoriesEvent()),
      ).toEqual({
        added: [{ externalId: '601000002', fullName: 'lobehub/lobehub-cloud', private: true }],
        installationId: '90001',
        removed: [{ externalId: '601000001', fullName: 'lobehub/lobehub', private: false }],
        type: 'installation_repositories',
      });
    });
  });

  it('ignores events it does not know and incomplete payloads', () => {
    expect(normalizeGitHubEvent('ping', { zen: 'x' })).toMatchObject({ type: 'ignored' });
    expect(normalizeGitHubEvent('pull_request', { action: 'opened' })).toMatchObject({
      type: 'ignored',
    });
  });
});

describe('describeGitHubDelivery', () => {
  it('extracts the ledger fields from a pull_request payload', () => {
    expect(describeGitHubDelivery(fx.pullRequestEvent('opened'))).toEqual({
      action: 'opened',
      installationId: '90001',
      number: 19_719,
      repoFullName: 'lobehub/lobehub',
    });
  });

  it('tolerates payloads without a pull request', () => {
    expect(describeGitHubDelivery({ zen: 'x' })).toEqual({
      action: null,
      installationId: null,
      number: null,
      repoFullName: null,
    });
  });
});
