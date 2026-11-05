import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { resolveLinkedPullRequest, useLinkedPullRequest } from '../useLinkedPullRequest';

const deviceReads = vi.hoisted(() => ({ linkedPR: undefined as unknown }));
const setPullRequestUrl = vi.hoisted(() => vi.fn());

vi.mock('@/store/device', () => ({
  useFetchGitBranch: () => ({ data: { branch: 'feat/x' }, isConfirmed: true, mutate: vi.fn() }),
  useFetchGitLinkedPR: () => ({ data: deviceReads.linkedPR, isConfirmed: true, mutate: vi.fn() }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: unknown) => unknown) =>
    selector({ setWorkingSidebarPullRequestUrl: setPullRequestUrl }),
}));

const pr = (number: number) => ({
  number,
  state: 'OPEN',
  title: `PR ${number}`,
  url: `u/${number}`,
});

const base = {
  available: true,
  branch: { branch: 'feat/x' },
  branchConfirmed: true,
  linkedPR: { pullRequest: pr(42), pullRequestStatus: 'ok' as const },
  linkedPRConfirmed: true,
};

describe('resolveLinkedPullRequest', () => {
  it('confirms a PR the live branch and lookup reads both answered', () => {
    expect(resolveLinkedPullRequest(base)).toEqual({
      confirmError: undefined,
      confirmed: true,
      pullRequest: pr(42),
    });
  });

  // Regression: after an external checkout between sessions the persisted
  // branch + linked PR painted the old PR, and its close / merge actions were
  // live before the device answered.
  it('paints but does not confirm a PR from persisted rows', () => {
    expect(resolveLinkedPullRequest({ ...base, branchConfirmed: false })).toEqual({
      confirmError: undefined,
      confirmed: false,
      pullRequest: pr(42),
    });
    expect(resolveLinkedPullRequest({ ...base, linkedPRConfirmed: false }).confirmed).toBe(false);
  });

  it('never confirms the topic snapshot stand-in', () => {
    const result = resolveLinkedPullRequest({
      ...base,
      linkedPR: undefined,
      linkedPRConfirmed: false,
      snapshot: { branch: 'feat/x', github: { pullRequest: pr(7) } },
    });
    expect(result).toEqual({ confirmError: undefined, confirmed: false, pullRequest: pr(7) });
  });

  it('lets a confirmed empty lookup hide the snapshot PR', () => {
    const result = resolveLinkedPullRequest({
      ...base,
      linkedPR: { pullRequest: null, pullRequestStatus: 'ok' },
      snapshot: { branch: 'feat/x', github: { pullRequest: pr(7) } },
    });
    expect(result).toEqual({ confirmError: undefined, confirmed: false, pullRequest: null });
  });

  // Regression: a failed branch / linked-PR read left the persisted PR locked
  // with no error and no retry in the PR pane.
  it('reports the failed read that keeps the PR unconfirmed', () => {
    const offline = new Error('device offline');
    expect(
      resolveLinkedPullRequest({ ...base, branchConfirmed: false, branchError: offline })
        .confirmError,
    ).toBe(offline);
    expect(
      resolveLinkedPullRequest({ ...base, linkedPRConfirmed: false, linkedPRError: offline })
        .confirmError,
    ).toBe(offline);
    expect(
      resolveLinkedPullRequest({ ...base, linkedPRError: offline }).confirmError,
    ).toBeUndefined();
  });
});

describe('useLinkedPullRequest', () => {
  const props = { available: true, gitPath: '/repo', isGithub: true };

  // Work cards open the PR tab only for the PR it shows, so the published URL
  // must follow the tab: set while it shows a PR, cleared once it can't.
  it('publishes the shown PR URL and clears it on unmount', () => {
    deviceReads.linkedPR = { pullRequest: pr(42), pullRequestStatus: 'ok' };
    const { rerender, unmount } = renderHook((p: typeof props) => useLinkedPullRequest(p), {
      initialProps: props,
    });
    expect(setPullRequestUrl).toHaveBeenLastCalledWith('u/42');

    rerender({ ...props, available: false });
    expect(setPullRequestUrl).toHaveBeenLastCalledWith(undefined);

    rerender(props);
    expect(setPullRequestUrl).toHaveBeenLastCalledWith('u/42');
    unmount();
    expect(setPullRequestUrl).toHaveBeenLastCalledWith(undefined);
  });
});
