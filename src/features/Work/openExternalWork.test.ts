import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isSamePullRequestUrl, openExternalWork } from './openExternalWork';

const globalState = vi.hoisted(() => ({
  openWorkingSidebar: vi.fn(),
  workingSidebarPullRequestUrl: undefined as string | undefined,
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: { getState: () => globalState },
}));

const PR_URL = 'https://github.com/lobehub/lobehub/pull/22293';

describe('isSamePullRequestUrl', () => {
  it('matches the same PR across case, sub-pages, query and fragment', () => {
    expect(isSamePullRequestUrl(PR_URL, PR_URL)).toBe(true);
    expect(isSamePullRequestUrl(PR_URL, 'https://github.com/LobeHub/LobeHub/pull/22293')).toBe(
      true,
    );
    expect(isSamePullRequestUrl(PR_URL, `${PR_URL}/files`)).toBe(true);
    expect(isSamePullRequestUrl(PR_URL, `${PR_URL}?w=1#discussion`)).toBe(true);
  });

  it('rejects another PR, repo, issue, or a missing URL', () => {
    expect(isSamePullRequestUrl(PR_URL, 'https://github.com/lobehub/lobehub/pull/2229')).toBe(
      false,
    );
    expect(isSamePullRequestUrl(PR_URL, 'https://github.com/lobehub/lobe-ui/pull/22293')).toBe(
      false,
    );
    expect(isSamePullRequestUrl(PR_URL, 'https://github.com/lobehub/lobehub/issues/22293')).toBe(
      false,
    );
    expect(isSamePullRequestUrl(PR_URL, undefined)).toBe(false);
    expect(isSamePullRequestUrl(undefined, undefined)).toBe(false);
  });
});

describe('openExternalWork', () => {
  const windowOpen = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('open', windowOpen);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    globalState.workingSidebarPullRequestUrl = undefined;
  });

  it('opens the Working Sidebar PR tab when it shows the same PR', () => {
    globalState.workingSidebarPullRequestUrl = PR_URL;

    openExternalWork(PR_URL);

    expect(globalState.openWorkingSidebar).toHaveBeenCalledWith('pr');
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('falls back to the URL when the sidebar shows another PR or none', () => {
    globalState.workingSidebarPullRequestUrl = 'https://github.com/lobehub/lobehub/pull/1';
    openExternalWork(PR_URL);
    globalState.workingSidebarPullRequestUrl = undefined;
    openExternalWork(PR_URL);

    expect(globalState.openWorkingSidebar).not.toHaveBeenCalled();
    expect(windowOpen).toHaveBeenCalledTimes(2);
    expect(windowOpen).toHaveBeenCalledWith(PR_URL, '_blank', 'noopener,noreferrer');
  });

  it('never opens a non-http(s) URL', () => {
    openExternalWork('javascript:alert(1)');

    expect(windowOpen).not.toHaveBeenCalled();
  });
});
