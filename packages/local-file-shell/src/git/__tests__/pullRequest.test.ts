import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getPullRequestActivity,
  getPullRequestDetail,
  normalizeMergeContext,
  normalizePullRequestDetail,
  pullRequestActionArgs,
  repoFromPullRequestUrl,
  runPullRequestAction,
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
  const repo = { name: 'lobe-chat', owner: 'lobehub' };

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
    headRefOid: 'a'.repeat(40),
    isCrossRepository: true,
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

  it('normalizes a mixed CheckRun/StatusContext payload; required is resolved by merge context', () => {
    const detail = normalizePullRequestDetail(basePayload, repo);

    expect(detail.isCrossRepository).toBe(true);
    expect(detail.headRefOid).toBe(basePayload.headRefOid);
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
        required: false,
        status: 'pending',
      },
    ]);
  });

  it('reports merged state from mergedAt regardless of raw state casing', () => {
    const detail = normalizePullRequestDetail(
      { ...basePayload, mergedAt: '2026-09-02T00:00:00Z', state: 'OPEN' },
      repo,
    );

    expect(detail.state).toBe('merged');
    expect(detail.mergedAt).toBe('2026-09-02T00:00:00Z');
  });

  it('maps closed and open states', () => {
    expect(normalizePullRequestDetail({ ...basePayload, state: 'CLOSED' }, repo).state).toBe(
      'closed',
    );
    expect(normalizePullRequestDetail(basePayload, repo).state).toBe('open');
  });

  it('maps autoMergeRequest to a lowercased method', () => {
    const detail = normalizePullRequestDetail(
      { ...basePayload, autoMergeRequest: { mergeMethod: 'SQUASH' } },
      repo,
    );

    expect(detail.autoMerge).toEqual({ method: 'squash' });
  });

  it('leaves permission and base drift unset until merge context resolves', () => {
    expect(normalizePullRequestDetail(basePayload, repo)).toMatchObject({
      baseBehindBy: 0,
      viewerCanBypass: false,
      viewerCanWrite: false,
    });
  });
});

describe('repoFromPullRequestUrl', () => {
  it('parses owner and repo from the PR url', () => {
    expect(repoFromPullRequestUrl('https://github.com/lobehub/lobe-chat/pull/42')).toEqual({
      name: 'lobe-chat',
      owner: 'lobehub',
    });
    expect(repoFromPullRequestUrl('')).toEqual({ name: '', owner: '' });
  });
});

describe('normalizeMergeContext', () => {
  const payload = (viewerPermission: string, contexts: string[] | null = ['ci']) => ({
    data: {
      repository: {
        pullRequest: {
          baseRef: {
            branchProtectionRule: { requiredStatusCheckContexts: contexts },
            name: 'main',
          },
          headRefOid: 'a'.repeat(40),
        },
        viewerPermission,
      },
    },
  });

  it.each([
    ['READ', false, false],
    ['WRITE', true, false],
    ['MAINTAIN', true, false],
    ['ADMIN', true, true],
  ])('maps %s permission', (permission, canWrite, canBypass) => {
    expect(normalizeMergeContext(payload(permission), 2)).toEqual({
      baseBehindBy: 2,
      requiredChecks: ['ci'],
      viewerCanBypass: canBypass,
      viewerCanWrite: canWrite,
    });
  });

  it('treats a missing protection rule as no required checks', () => {
    expect(normalizeMergeContext(payload('WRITE', null), 0).requiredChecks).toEqual([]);
    expect(normalizeMergeContext({}, 0)).toMatchObject({
      requiredChecks: [],
      viewerCanWrite: false,
    });
  });
});

describe('pullRequestActionArgs', () => {
  const cases: [GitPullRequestAction, string[][]][] = [
    [
      { headRefOid: 'a'.repeat(40), method: 'squash', type: 'merge' },
      [['pr', 'merge', '42', '--squash', '--match-head-commit', 'a'.repeat(40)]],
    ],
    [
      {
        admin: true,
        deleteBranch: true,
        headRefOid: 'a'.repeat(40),
        method: 'squash',
        type: 'merge',
      },
      [
        [
          'pr',
          'merge',
          '42',
          '--squash',
          '--match-head-commit',
          'a'.repeat(40),
          '--admin',
          '--delete-branch',
        ],
      ],
    ],
    [
      { headRefOid: 'a'.repeat(40), method: 'rebase', type: 'autoMerge' },
      [['pr', 'merge', '42', '--auto', '--rebase', '--match-head-commit', 'a'.repeat(40)]],
    ],
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
    [{ base: 'canary', type: 'changeBase' }, [['pr', 'edit', '42', '--base', 'canary']]],
  ];

  it.each(cases)('maps %o to argv', (action, expected) => {
    expect(pullRequestActionArgs(42, action)).toEqual(expected);
  });

  it.each([['../fix'], ['fix/../../etc'], ['fix bug'], ['fix;rm -rf']])(
    'rejects an unsafe branch name %s for deleteBranch and changeBase',
    (name) => {
      expect(() => pullRequestActionArgs(42, { head: name, type: 'deleteBranch' })).toThrow(
        'Invalid branch name',
      );
      expect(() => pullRequestActionArgs(42, { base: name, type: 'changeBase' })).toThrow(
        'Invalid branch name',
      );
    },
  );
});

describe('runPullRequestAction head protection', () => {
  beforeEach(() => {
    childProcessMocks.execFileAsync.mockReset();
  });

  it.each(['merge', 'autoMerge'] as const)(
    'rejects missing or invalid heads before executing %s',
    async (type) => {
      for (const headRefOid of [undefined, '', 'abc', '--admin']) {
        const result = await runPullRequestAction({
          action: { headRefOid, method: 'squash', type } as GitPullRequestAction,
          number: 42,
          path: '/repo',
        });
        expect(result.success).toBe(false);
      }
      expect(childProcessMocks.execFileAsync).not.toHaveBeenCalled();
    },
  );

  it.each(['merge', 'autoMerge'] as const)(
    'fails %s when the remote head has moved',
    async (type) => {
      childProcessMocks.execFileAsync.mockImplementation(async (_command, args) => {
        if (args[args.indexOf('--match-head-commit') + 1] !== 'b'.repeat(40)) {
          throw Object.assign(new Error('head changed'), { stderr: 'head changed' });
        }
        return { stdout: '' };
      });
      const result = await runPullRequestAction({
        action: { headRefOid: 'a'.repeat(40), method: 'squash', type },
        number: 42,
        path: '/repo',
      });
      expect(result).toEqual({ error: 'head changed', success: false });
    },
  );
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

describe('incremental pull request reads', () => {
  it('returns core data while the activity request is still pending', async () => {
    let releaseActivity!: (value: { stdout: string }) => void;
    const raw = {
      number: 42,
      title: 'Ready first',
      url: 'https://github.com/test/repo/pull/42',
      state: 'OPEN',
      headRefOid: 'a'.repeat(40),
      baseRefName: 'main',
      headRefName: 'feature',
      additions: 2,
      deletions: 1,
      changedFiles: 1,
    };
    childProcessMocks.execFileAsync.mockImplementation(async (_cmd, args) => {
      const fields = args[args.indexOf('--json') + 1].split(',');
      if (fields.includes('comments'))
        return new Promise<{ stdout: string }>((resolve) => {
          releaseActivity = resolve;
        });
      return { stdout: JSON.stringify(raw) };
    });
    const core = await getPullRequestDetail({ coreOnly: true, number: 42, path: '/repo' });
    expect(core.detail).toMatchObject({
      title: 'Ready first',
      comments: [],
      viewerCanWrite: false,
    });
    const activity = getPullRequestActivity({ number: 42, path: '/repo' });
    releaseActivity({
      stdout: JSON.stringify({
        comments: [
          { id: 'c1', author: { login: 'reviewer' }, body: 'Arrived later', createdAt: 'now' },
        ],
      }),
    });
    expect(await activity).toMatchObject({
      comments: [{ body: 'Arrived later', author: 'reviewer' }],
      commits: [],
      reviews: [],
    });
  });

  it('propagates activity failures instead of reporting an empty timeline', async () => {
    childProcessMocks.execFileAsync.mockRejectedValue(new Error('offline'));
    await expect(getPullRequestActivity({ number: 42, path: '/repo' })).rejects.toThrow('offline');
  });
});
