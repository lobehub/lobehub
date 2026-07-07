import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLinkedPullRequest } from '../info';

const childProcessMocks = vi.hoisted(() => ({
  execFileAsync: vi.fn(),
}));

vi.mock('node:child_process', () => {
  const execFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: childProcessMocks.execFileAsync,
  });

  return { execFile };
});

describe('getLinkedPullRequest', () => {
  beforeEach(() => {
    childProcessMocks.execFileAsync.mockReset();
  });

  it('queries the preserved PR number directly when provided', async () => {
    childProcessMocks.execFileAsync.mockResolvedValue({
      stderr: '',
      stdout: JSON.stringify({
        isDraft: false,
        mergeStateStatus: 'CLEAN',
        mergeable: 'MERGEABLE',
        mergedAt: '2026-07-07T09:00:00Z',
        number: 123,
        reviewDecision: 'APPROVED',
        state: 'MERGED',
        statusCheckRollup: [{ conclusion: 'SUCCESS' }],
        title: 'fix: stop stale running topics',
        url: 'https://github.com/lobehub/lobehub/pull/123',
      }),
    });

    const result = await getLinkedPullRequest({
      branch: 'fix/topic-running',
      path: '/repo',
      pullRequestNumber: 123,
    });

    expect(childProcessMocks.execFileAsync).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['pr', 'view', '123', '--json']),
      { cwd: '/repo', timeout: 8000 },
    );
    expect(childProcessMocks.execFileAsync.mock.calls[0]![1]).not.toContain('--head');
    expect(result.pullRequest).toMatchObject({ mergedAt: '2026-07-07T09:00:00Z', number: 123 });
  });

  it('queries all PR states so merged pull requests can refresh topic metadata', async () => {
    childProcessMocks.execFileAsync.mockResolvedValue({
      stderr: '',
      stdout: JSON.stringify([
        {
          isDraft: false,
          mergeStateStatus: 'CLEAN',
          mergeable: 'MERGEABLE',
          mergedAt: '2026-07-07T09:00:00Z',
          number: 123,
          reviewDecision: 'APPROVED',
          state: 'MERGED',
          statusCheckRollup: [{ conclusion: 'SUCCESS' }],
          title: 'fix: stop stale running topics',
          url: 'https://github.com/lobehub/lobehub/pull/123',
        },
      ]),
    });

    const result = await getLinkedPullRequest({ branch: 'fix/topic-running', path: '/repo' });

    expect(childProcessMocks.execFileAsync).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['--head', 'fix/topic-running', '--state', 'all']),
      { cwd: '/repo', timeout: 8000 },
    );
    expect(result).toEqual({
      extraCount: 0,
      pullRequest: {
        ciStatus: 'success',
        isDraft: false,
        mergeStateStatus: 'CLEAN',
        mergeable: 'MERGEABLE',
        mergedAt: '2026-07-07T09:00:00Z',
        number: 123,
        reviewDecision: 'APPROVED',
        state: 'MERGED',
        title: 'fix: stop stale running topics',
        url: 'https://github.com/lobehub/lobehub/pull/123',
      },
      status: 'ok',
    });
  });
});
