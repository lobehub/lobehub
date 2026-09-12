import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getPullRequestDetail,
  normalizePullRequestDetail,
  pullRequestActionArgs,
} from '../pullRequest';
import type { GitPullRequestAction } from '../types';

const childProcessMocks = vi.hoisted(() => ({
  execFileAsync: vi.fn(),
}));

vi.mock('node:child_process', () => {
  const execFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: childProcessMocks.execFileAsync,
  });

  return { execFile };
});

describe('normalizePullRequestDetail', () => {
  const repo = { name: 'lobe-chat', owner: 'lobehub', viewerPermission: 'WRITE' };

  const basePayload = {
    additions: 12,
    author: { login: 'innei' },
    autoMergeRequest: null as { mergeMethod?: string | null } | null,
    baseRefName: 'main',
    body: 'body text',
    changedFiles: 3,
    comments: [
      { author: { login: 'bot' }, body: 'lgtm', createdAt: '2026-09-01T00:00:00Z', id: 'c1' },
    ],
    commits: [
      {
        authors: [{ login: 'innei' }],
        committedDate: '2026-09-01T00:00:00Z',
        messageHeadline: 'fix bug',
        oid: 'abc123',
      },
    ],
    deletions: 4,
    headRefName: 'fix/bug',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergedAt: null as string | null,
    mergeStateStatus: 'CLEAN',
    number: 42,
    reviewDecision: 'APPROVED',
    reviews: [
      { author: { login: 'reviewer' }, state: 'APPROVED', submittedAt: '2026-09-01T00:00:00Z' },
    ],
    state: 'OPEN',
    statusCheckRollup: [
      {
        completedAt: '2026-09-01T00:01:00Z',
        conclusion: 'success',
        detailsUrl: 'https://ci/run/1',
        name: 'build',
        startedAt: '2026-09-01T00:00:00Z',
        status: 'completed',
      },
      { context: 'legacy-status', state: 'pending', targetUrl: 'https://ci/run/2' },
    ],
    title: 'Fix a bug',
    url: 'https://github.com/lobehub/lobe-chat/pull/42',
  };

  it('normalizes a mixed CheckRun/StatusContext payload with required tagging', () => {
    const detail = normalizePullRequestDetail(basePayload, repo, new Set(['legacy-status']));

    expect(detail.checks).toEqual([
      {
        completedAt: '2026-09-01T00:01:00Z',
        detailsUrl: 'https://ci/run/1',
        name: 'build',
        required: false,
        startedAt: '2026-09-01T00:00:00Z',
        status: 'success',
      },
      {
        detailsUrl: 'https://ci/run/2',
        name: 'legacy-status',
        required: true,
        status: 'pending',
      },
    ]);
  });

  it('reports merged state from mergedAt regardless of raw state casing', () => {
    const detail = normalizePullRequestDetail(
      { ...basePayload, mergedAt: '2026-09-02T00:00:00Z', state: 'OPEN' },
      repo,
      new Set(),
    );

    expect(detail.state).toBe('merged');
    expect(detail.mergedAt).toBe('2026-09-02T00:00:00Z');
  });

  it('maps closed and open states', () => {
    expect(
      normalizePullRequestDetail({ ...basePayload, state: 'CLOSED' }, repo, new Set()).state,
    ).toBe('closed');
    expect(normalizePullRequestDetail(basePayload, repo, new Set()).state).toBe('open');
  });

  it('maps autoMergeRequest to a lowercased method', () => {
    const detail = normalizePullRequestDetail(
      { ...basePayload, autoMergeRequest: { mergeMethod: 'SQUASH' } },
      repo,
      new Set(),
    );

    expect(detail.autoMerge).toEqual({ method: 'squash' });
  });

  it('maps viewer permission to viewerCanWrite / viewerCanBypass', () => {
    expect(
      normalizePullRequestDetail(basePayload, { ...repo, viewerPermission: 'READ' }, new Set()),
    ).toMatchObject({ viewerCanBypass: false, viewerCanWrite: false });
    expect(
      normalizePullRequestDetail(basePayload, { ...repo, viewerPermission: 'WRITE' }, new Set()),
    ).toMatchObject({ viewerCanBypass: false, viewerCanWrite: true });
    expect(
      normalizePullRequestDetail(basePayload, { ...repo, viewerPermission: 'MAINTAIN' }, new Set()),
    ).toMatchObject({ viewerCanBypass: false, viewerCanWrite: true });
    expect(
      normalizePullRequestDetail(basePayload, { ...repo, viewerPermission: 'ADMIN' }, new Set()),
    ).toMatchObject({ viewerCanBypass: true, viewerCanWrite: true });
  });
});

describe('pullRequestActionArgs', () => {
  const cases: [GitPullRequestAction, string[][]][] = [
    [{ method: 'squash', type: 'merge' }, [['pr', 'merge', '42', '--squash']]],
    [
      { admin: true, deleteBranch: true, method: 'squash', type: 'merge' },
      [['pr', 'merge', '42', '--squash', '--admin', '--delete-branch']],
    ],
    [{ method: 'rebase', type: 'autoMerge' }, [['pr', 'merge', '42', '--auto', '--rebase']]],
    [{ type: 'disableAutoMerge' }, [['pr', 'merge', '42', '--disable-auto']]],
    [{ method: 'rebase', type: 'updateBranch' }, [['pr', 'update-branch', '42', '--rebase']]],
    [{ method: 'merge', type: 'updateBranch' }, [['pr', 'update-branch', '42']]],
    [{ type: 'ready' }, [['pr', 'ready', '42']]],
    [{ body: 'nice', type: 'comment' }, [['pr', 'comment', '42', '--body', 'nice']]],
    [{ type: 'close' }, [['pr', 'close', '42']]],
    [{ type: 'reopen' }, [['pr', 'reopen', '42']]],
    [
      { head: 'fix/bug', type: 'deleteBranch' },
      [['api', '-X', 'DELETE', 'repos/{owner}/{repo}/git/refs/heads/fix/bug']],
    ],
  ];

  it.each(cases)('maps %o to argv', (action, expected) => {
    expect(pullRequestActionArgs(42, action)).toEqual(expected);
  });
});

describe('getPullRequestDetail', () => {
  beforeEach(() => {
    childProcessMocks.execFileAsync.mockReset();
  });

  it('reports gh-missing when the gh CLI is unavailable', async () => {
    childProcessMocks.execFileAsync.mockRejectedValue(
      Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }),
    );

    expect(await getPullRequestDetail({ number: 42, path: '/repo' })).toEqual({
      detail: null,
      status: 'gh-missing',
    });
  });

  it('reports error on any other gh failure', async () => {
    childProcessMocks.execFileAsync.mockRejectedValue(
      Object.assign(new Error('boom'), { stderr: 'boom' }),
    );

    expect(await getPullRequestDetail({ number: 42, path: '/repo' })).toEqual({
      detail: null,
      status: 'error',
    });
  });
});
