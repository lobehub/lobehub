import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GitStatus from '../GitStatus';

const globalStoreMock = vi.hoisted(() => ({
  setWorkingSidebarTab: vi.fn(),
  status: {
    showRightPanel: false,
    workingSidebarTab: 'resources',
  },
  toggleRightPanel: vi.fn(),
}));

const gitHookMocks = vi.hoisted(() => ({
  mutateAheadBehind: vi.fn(),
  mutateBranch: vi.fn(),
  mutatePR: vi.fn(),
  mutateReviewPatches: vi.fn(),
  mutateWorktrees: vi.fn(),
  useFetchGitAheadBehind: vi.fn(),
  useFetchGitBranch: vi.fn(),
  useFetchGitLinkedPR: vi.fn(),
  useReviewPatches: vi.fn(),
  useFetchGitWorktrees: vi.fn(),
}));

const systemMocks = vi.hoisted(() => ({ openExternalLink: vi.fn() }));

vi.mock('../BranchSwitcher', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../WorktreeSwitcher', () => ({
  default: () => <span data-testid="worktree-switcher" />,
}));

vi.mock('@/store/device', () => ({
  useFetchGitAheadBehind: gitHookMocks.useFetchGitAheadBehind,
  useFetchGitBranch: gitHookMocks.useFetchGitBranch,
  useFetchGitLinkedPR: gitHookMocks.useFetchGitLinkedPR,
  useReviewPatches: gitHookMocks.useReviewPatches,
  useFetchGitWorktrees: gitHookMocks.useFetchGitWorktrees,
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: typeof globalStoreMock) => unknown) =>
    selector(globalStoreMock),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    showRightPanel: (state: typeof globalStoreMock) => state.status.showRightPanel,
  },
}));

vi.mock('@/services/electron/system', () => ({
  electronSystemService: { openExternalLink: systemMocks.openExternalLink },
}));

vi.mock('@/services/git', () => ({
  gitService: {
    pullGitBranch: vi.fn(),
    pushGitBranch: vi.fn(),
  },
}));

vi.mock('@/components/AntdStaticMethods', () => ({
  message: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  DropdownMenuPopup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuPositioner: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuRoot: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock('@/components/RingLoading', () => ({
  default: () => <span data-testid="ring-loading" />,
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => <span data-testid="icon" />,
  Tooltip: ({ children, title }: { children: ReactNode; title?: ReactNode }) => (
    <div data-title={typeof title === 'string' ? title : undefined}>{children}</div>
  ),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({}),
  cssVar: new Proxy({}, { get: () => 'var(--mock)' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  globalStoreMock.status.showRightPanel = false;
  globalStoreMock.status.workingSidebarTab = 'resources';

  gitHookMocks.useFetchGitBranch.mockReturnValue({
    data: { branch: 'fix/remote-review', detached: false },
    mutate: gitHookMocks.mutateBranch,
  });
  gitHookMocks.useFetchGitLinkedPR.mockReturnValue({
    data: { pullRequest: null },
    mutate: gitHookMocks.mutatePR,
  });
  gitHookMocks.useReviewPatches.mockReturnValue({
    data: {
      mode: 'unstaged',
      patches: [
        {
          additions: 3,
          deletions: 1,
          filePath: 'src/example.ts',
          isBinary: false,
          patch: '',
          status: 'modified',
          truncated: false,
        },
      ],
    },
    mutate: gitHookMocks.mutateReviewPatches,
  });
  gitHookMocks.useFetchGitAheadBehind.mockReturnValue({
    data: undefined,
    mutate: gitHookMocks.mutateAheadBehind,
  });
  gitHookMocks.useFetchGitWorktrees.mockReturnValue({
    data: [],
    mutate: gitHookMocks.mutateWorktrees,
  });
});

describe('GitStatus', () => {
  it('opens the review panel when clicking remote device diff stats', () => {
    render(<GitStatus agentId="agent-1" deviceId="device-1" isGithub={false} path="/repo" />);

    expect(gitHookMocks.useReviewPatches).toHaveBeenCalledWith(
      '/repo',
      'unstaged',
      undefined,
      'device-1',
    );
    expect(screen.getByText('+3')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));

    expect(globalStoreMock.setWorkingSidebarTab).toHaveBeenCalledWith('review');
    expect(globalStoreMock.toggleRightPanel).toHaveBeenCalledWith(true);
  });

  it('renders the linked GitHub PR number as a live display (no topic write)', async () => {
    gitHookMocks.useFetchGitLinkedPR.mockReturnValue({
      data: {
        pullRequest: {
          ciStatus: 'pending',
          mergeStateStatus: 'CLEAN',
          number: 123,
          state: 'OPEN',
          title: 'Improve worktree handling',
          url: 'https://github.com/lobehub/lobehub/pull/123',
        },
        pullRequestStatus: 'ok',
      },
      mutate: gitHookMocks.mutatePR,
    });

    render(<GitStatus isGithub agentId="agent-1" path="/repo" />);

    // Pure display: the chip shows the current branch's PR number. Persisting it
    // onto the topic now happens at send time (see snapshotWorkingDirGit), so
    // opening a topic must never mutate its stored branch/PR here.
    await waitFor(() => {
      expect(screen.getByText('#123')).toBeInTheDocument();
    });
  });

  it('keeps branch switching visible when worktrees are available', () => {
    gitHookMocks.useFetchGitWorktrees.mockReturnValue({
      data: [
        { branch: 'fix/remote-review', current: true, path: '/repo' },
        { branch: 'canary', current: false, path: '/repo-canary' },
      ],
      mutate: gitHookMocks.mutateWorktrees,
    });

    render(<GitStatus isGithub agentId="agent-1" path="/repo" sourcePath="/repo" />);

    expect(screen.getByTestId('worktree-switcher')).toBeInTheDocument();
    expect(screen.getByText('fix/remote-review')).toBeInTheDocument();
  });

  it('forwards detached HEAD state to disable linked PR discovery', () => {
    gitHookMocks.useFetchGitBranch.mockReturnValue({
      data: { branch: 'abc1234', detached: true },
      mutate: gitHookMocks.mutateBranch,
    });

    render(<GitStatus isGithub agentId="agent-1" deviceId="device-1" path="/repo" />);

    expect(gitHookMocks.useFetchGitLinkedPR).toHaveBeenCalledWith(
      'device-1',
      '/repo',
      'abc1234',
      true,
      true,
    );
  });

  it('shows every linked PR with the accurate count, base branch, and independent URL', () => {
    gitHookMocks.useFetchGitLinkedPR.mockReturnValue({
      data: {
        pullRequest: {
          baseRefName: 'canary',
          number: 2,
          state: 'OPEN',
          title: 'Newest',
          url: 'url-2',
        },
        pullRequests: [
          { baseRefName: 'canary', number: 2, state: 'OPEN', title: 'Newest', url: 'url-2' },
          { number: 1, state: 'OPEN', title: 'Older', url: 'url-1' },
        ],
        pullRequestStatus: 'ok',
      },
      mutate: gitHookMocks.mutatePR,
    });
    render(<GitStatus isGithub agentId="agent-1" path="/repo" />);

    expect(screen.getByText('#2 +1')).toBeInTheDocument();
    expect(screen.getByText('#2 Newest → canary')).toBeInTheDocument();
    fireEvent.click(screen.getByText('#1 Older'));
    expect(systemMocks.openExternalLink).toHaveBeenCalledWith('url-1');
  });

  it.each(['gh-missing', 'error'])(
    'offers retry for %s without displaying a stale PR',
    (status) => {
      gitHookMocks.useFetchGitLinkedPR.mockReturnValue({
        data: { ghMissing: status === 'gh-missing', pullRequest: null, pullRequestStatus: status },
        mutate: gitHookMocks.mutatePR,
      });
      render(<GitStatus isGithub agentId="agent-1" path="/repo" />);
      fireEvent.click(screen.getByText('workingDirectory.retry'));
      expect(gitHookMocks.mutatePR).toHaveBeenCalled();
    },
  );
});
