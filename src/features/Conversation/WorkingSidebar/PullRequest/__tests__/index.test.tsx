import type { DeviceGitPullRequestDetail, DeviceGitPullRequestDetailResult } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PullRequest from '../index';

const detailHook = vi.hoisted(() => vi.fn());
const openExternalLink = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/device', () => ({
  useFetchGitAheadBehind: () => ({ data: undefined }),
  useFetchGitPullRequestDetail: detailHook,
  useFetchGitWorkingTreeStatus: () => ({ data: undefined }),
}));

vi.mock('@/services/git', () => ({
  gitService: { pushGitBranch: vi.fn(), runPullRequestAction: vi.fn() },
}));

vi.mock('@/libs/swr', () => ({ mutate: vi.fn() }));

vi.mock('@/services/electron/system', () => ({
  electronSystemService: { openExternalLink },
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  Markdown: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  DropdownMenu: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const detail: DeviceGitPullRequestDetail = {
  additions: 10,
  author: 'innei',
  autoMerge: null,
  baseRefName: 'main',
  body: 'Some **body**',
  changedFiles: 2,
  checks: [{ name: 'ci', required: true, status: 'success' }],
  comments: [{ author: 'foo', body: 'lgtm', createdAt: '2026-09-13T01:00:00Z', id: 'c1' }],
  commits: [
    { author: 'innei', committedAt: '2026-09-13T00:00:00Z', message: 'fix', sha: 'abc1234' },
  ],
  deletions: 2,
  headRefName: 'feat/x',
  isDraft: false,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  number: 42,
  repo: { name: 'lobe-chat', owner: 'lobehub' },
  reviewDecision: 'APPROVED',
  reviews: [],
  state: 'open',
  title: 'Native PR tab',
  url: 'https://github.com/lobehub/lobe-chat/pull/42',
  viewerCanBypass: false,
  viewerCanWrite: true,
};

const setDetail = (state: {
  data?: DeviceGitPullRequestDetailResult;
  error?: Error;
  isLoading?: boolean;
}) => detailHook.mockReturnValue({ data: undefined, isLoading: false, mutate: vi.fn(), ...state });

const renderPane = (onOpenTab = vi.fn()) => {
  render(
    <PullRequest
      active
      number={42}
      url={detail.url}
      workingDirectory={'/repo'}
      onOpenTab={onOpenTab}
    />,
  );
  return onOpenTab;
};

describe('PullRequest pane', () => {
  beforeEach(() => {
    detailHook.mockReset();
    openExternalLink.mockReset();
  });

  it('shows a skeleton while loading', () => {
    setDetail({ isLoading: true });
    const { container } = render(
      <PullRequest active number={42} workingDirectory={'/repo'} onOpenTab={vi.fn()} />,
    );
    expect(container.querySelector('[data-testid="pr-primary-action"]')).toBeNull();
    expect(screen.queryByText('Native PR tab')).toBeNull();
  });

  it('renders the gh-missing state with browser fallback', () => {
    setDetail({ data: { detail: null, status: 'gh-missing' } });
    renderPane();
    expect(screen.getByText('workingPanel.pr.ghMissing.title')).toBeTruthy();

    fireEvent.click(screen.getByText('workingPanel.pr.ghMissing.open'));
    expect(openExternalLink).toHaveBeenCalledWith(detail.url);
  });

  it('renders an error row with retry when the fetch fails', () => {
    const mutate = vi.fn();
    detailHook.mockReturnValue({
      data: undefined,
      error: new Error('boom'),
      isLoading: false,
      mutate,
    });
    renderPane();
    expect(screen.getByText('workingPanel.pr.error.load')).toBeTruthy();

    fireEvent.click(screen.getByText('retry'));
    expect(mutate).toHaveBeenCalled();
  });

  it('renders header, sections and dock from detail', () => {
    setDetail({ data: { detail, status: 'ok' } });
    const onOpenTab = renderPane();

    expect(screen.getByText('Native PR tab')).toBeTruthy();
    expect(screen.getByText('feat/x')).toBeTruthy();
    expect(screen.getByText('lgtm')).toBeTruthy();
    expect(screen.getByTestId('pr-primary-action').textContent).toBe(
      'workingPanel.pr.method.squash',
    );

    fireEvent.click(screen.getByText('workingPanel.pr.files.openReview'));
    expect(onOpenTab).toHaveBeenCalledWith('review');
  });
});
