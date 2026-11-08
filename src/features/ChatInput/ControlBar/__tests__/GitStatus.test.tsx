import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gitService } from '@/services/git';

import GitStatus from '../GitStatus';

const globalStoreMock = vi.hoisted(() => ({
  openWorkingSidebar: vi.fn(),
  status: {
    showRightPanel: false,
    workingSidebarTab: 'resources',
  },
  toggleRightPanel: vi.fn(),
}));

const deviceStoreMock = vi.hoisted(() => ({
  devices: [] as { deviceId: string; online: boolean }[],
}));

const gitHookMocks = vi.hoisted(() => ({
  mutateAheadBehind: vi.fn(),
  mutateBranch: vi.fn(),
  mutatePR: vi.fn(),
  mutateReviewPatches: vi.fn(),
  mutateWorktrees: vi.fn(),
  setDiffStats: vi.fn(),
  useFetchGitAheadBehind: vi.fn(),
  useFetchGitBranch: vi.fn(),
  useFetchGitDiffStats: vi.fn(),
  useFetchGitLinkedPR: vi.fn(),
  useReviewPatches: vi.fn(),
  useFetchGitWorktrees: vi.fn(),
}));

vi.mock('../BranchSwitcher', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../WorktreeSwitcher', () => ({
  default: ({ disabled }: { disabled?: boolean }) => (
    <span data-disabled={Boolean(disabled)} data-testid="worktree-switcher" />
  ),
}));

vi.mock('../StaleGitSnapshot', () => ({
  default: ({ git }: { git: { branch?: string } }) => (
    <span data-branch={git.branch} data-testid="stale-git-snapshot" />
  ),
}));

vi.mock('@/store/device', () => ({
  deviceSelectors: {
    getDeviceById: (deviceId?: string) => (state: typeof deviceStoreMock) =>
      state.devices.find((d) => d.deviceId === deviceId),
  },
  useDeviceStore: (selector: (state: typeof deviceStoreMock) => unknown) =>
    selector(deviceStoreMock),
  useFetchGitAheadBehind: gitHookMocks.useFetchGitAheadBehind,
  useFetchGitBranch: gitHookMocks.useFetchGitBranch,
  useFetchGitDiffStats: gitHookMocks.useFetchGitDiffStats,
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
  electronSystemService: { openExternalLink: vi.fn() },
}));

vi.mock('@/services/git', () => ({
  gitService: {
    pullGitBranch: vi.fn(),
    pushGitBranch: vi.fn(),
  },
}));

vi.mock('@/components/RingLoading', () => ({
  default: () => <span data-testid="ring-loading" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  deviceStoreMock.devices = [{ deviceId: 'device-1', online: true }];
  globalStoreMock.status.showRightPanel = false;
  globalStoreMock.status.workingSidebarTab = 'resources';

  gitHookMocks.useFetchGitBranch.mockReturnValue({
    data: { branch: 'fix/remote-review', detached: false },
    isConfirmed: true,
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
    isConfirmed: true,
    mutate: gitHookMocks.mutateWorktrees,
  });
  gitHookMocks.useFetchGitDiffStats.mockReturnValue({
    data: undefined,
    set: gitHookMocks.setDiffStats,
  });
});

describe('GitStatus', () => {
  it('opens the review panel when clicking remote device diff stats', async () => {
    render(<GitStatus agentId="agent-1" deviceId="device-1" isGithub={false} path="/repo" />);

    expect(gitHookMocks.useReviewPatches).toHaveBeenCalledWith(
      '/repo',
      'unstaged',
      undefined,
      'device-1',
      true,
    );
    expect(screen.getByText('+3')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
    // The confirmed counts are handed to the replica so a reload can paint them.
    await waitFor(() =>
      expect(gitHookMocks.setDiffStats).toHaveBeenCalledWith({
        additions: 3,
        deletions: 1,
        files: 1,
      }),
    );

    fireEvent.click(screen.getByRole('button'));

    expect(globalStoreMock.openWorkingSidebar).toHaveBeenCalledWith('review');
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

  // The diff counts come from a separate read. Their persisted copy keeps the
  // composer cluster stable while that read is still in flight.
  it('paints the persisted change counts while the review patches load', () => {
    gitHookMocks.useReviewPatches.mockReturnValue({
      data: undefined,
      mutate: gitHookMocks.mutateReviewPatches,
    });
    gitHookMocks.useFetchGitDiffStats.mockReturnValue({
      data: { additions: 4, deletions: 2, files: 2 },
      set: gitHookMocks.setDiffStats,
    });

    render(<GitStatus isGithub agentId="agent-1" path="/repo" />);

    expect(screen.getByText('+4')).toBeInTheDocument();
    expect(screen.getByText('-2')).toBeInTheDocument();
    expect(gitHookMocks.setDiffStats).not.toHaveBeenCalled();
  });

  // Review P1: the stale-first branch is a paint-only stand-in. Checkout, pull
  // and push must wait until this session's probe confirms it.
  it('keeps checkout, pull and push inert until the current probe confirms the branch', () => {
    gitHookMocks.useFetchGitBranch.mockReturnValue({
      data: { branch: 'fix/remote-review', detached: false },
      isConfirmed: false,
      mutate: gitHookMocks.mutateBranch,
    });
    gitHookMocks.useFetchGitAheadBehind.mockReturnValue({
      data: { ahead: 2, behind: 1, hasUpstream: true, upstream: 'origin/fix/remote-review' },
      mutate: gitHookMocks.mutateAheadBehind,
    });
    gitHookMocks.useFetchGitWorktrees.mockReturnValue({
      data: [
        { branch: 'fix/remote-review', current: true, path: '/repo' },
        { branch: 'canary', current: false, path: '/repo-canary' },
      ],
      mutate: gitHookMocks.mutateWorktrees,
    });

    render(<GitStatus isGithub agentId="agent-1" path="/repo" sourcePath="/repo" />);

    // The branch label still paints…
    expect(screen.getByText('fix/remote-review')).toBeInTheDocument();
    // …and the worktree entry stays mounted (removing it would shift the branch
    // chip when it returns) but is inert until confirmation.
    expect(screen.getByTestId('worktree-switcher')).toHaveAttribute('data-disabled', 'true');
    const push = screen.getByText('2').closest('[role="button"]')!;
    const pull = screen.getByText('1').closest('[role="button"]')!;
    expect(push).toHaveAttribute('aria-disabled', 'true');
    expect(pull).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(push);
    fireEvent.click(pull);
    expect(gitService.pushGitBranch).not.toHaveBeenCalled();
    expect(gitService.pullGitBranch).not.toHaveBeenCalled();
  });

  // Review P1: after a reload where the repository was switched externally from
  // A to B, the faster branch probe confirms B while the persisted ahead/behind
  // row still describes A. Enabling sync there would pull/push the ACTUAL branch
  // B using A's counts and target text, so that read must confirm too.
  it('keeps pull and push inert while ahead/behind is still the previous snapshot', async () => {
    gitHookMocks.useFetchGitAheadBehind.mockReturnValue({
      data: { ahead: 2, behind: 1, hasUpstream: true, upstream: 'origin/previous' },
      isConfirmed: false,
      mutate: gitHookMocks.mutateAheadBehind,
    });

    const { unmount } = render(
      <GitStatus isGithub agentId="agent-1" path="/repo" sourcePath="/repo" />,
    );

    // The previous snapshot keeps painting (that is the point of stale-first)…
    const push = screen.getByText('2').closest('[role="button"]')!;
    const pull = screen.getByText('1').closest('[role="button"]')!;
    expect(push).toHaveAttribute('aria-disabled', 'true');
    expect(pull).toHaveAttribute('aria-disabled', 'true');

    // …but neither action may run against it.
    fireEvent.click(push);
    fireEvent.click(pull);
    expect(gitService.pushGitBranch).not.toHaveBeenCalled();
    expect(gitService.pullGitBranch).not.toHaveBeenCalled();

    // Once the live ahead/behind read answers, the same chips become actionable.
    gitHookMocks.useFetchGitAheadBehind.mockReturnValue({
      data: { ahead: 2, behind: 1, hasUpstream: true, upstream: 'origin/current' },
      isConfirmed: true,
      mutate: gitHookMocks.mutateAheadBehind,
    });
    // `GitStatus` is memoized, so a same-prop rerender bails out; remount instead.
    unmount();
    render(<GitStatus isGithub agentId="agent-1" path="/repo" sourcePath="/repo" />);

    const readyPush = screen.getByText('2').closest('[role="button"]')!;
    expect(readyPush).toHaveAttribute('aria-disabled', 'false');
  });

  // Review P1: the branch picker routes through the worktree list. A confirmed
  // branch alone must not enable a picker that still holds last session's
  // worktrees — it could point at a worktree removed externally.
  it('keeps both pickers inert until the worktree list itself is confirmed', () => {
    gitHookMocks.useFetchGitBranch.mockReturnValue({
      data: { branch: 'fix/remote-review', detached: false },
      isConfirmed: true,
      mutate: gitHookMocks.mutateBranch,
    });
    gitHookMocks.useFetchGitWorktrees.mockReturnValue({
      data: [
        { branch: 'fix/remote-review', current: true, path: '/repo' },
        { branch: 'canary', current: false, path: '/repo-canary' },
      ],
      isConfirmed: false,
      mutate: gitHookMocks.mutateWorktrees,
    });

    render(<GitStatus isGithub agentId="agent-1" path="/repo" sourcePath="/repo" />);

    // The trigger keeps its width (no layout jump) but cannot switch.
    expect(screen.getByTestId('worktree-switcher')).toHaveAttribute('data-disabled', 'true');
  });

  describe('deleted working directory', () => {
    // The recorded worktree gets removed once its task is done, but the topic
    // keeps pointing at it — the live branch probe then reads nothing and the
    // whole cluster used to collapse, while the sidebar hover card (which reads
    // the same persisted snapshot, no probe) still showed branch + PR.
    const fallbackGit = {
      activeWorktree: '/tmp/lobehub-wt-subtask',
      branch: 'feat/task-list-subtask-nesting',
      isWorktree: true,
    };

    beforeEach(() => {
      // `getGitBranch` resolves to `{}` for a path it can't read — a SETTLED
      // probe that found no branch, not a pending one.
      gitHookMocks.useFetchGitBranch.mockReturnValue({
        data: {},
        isConfirmed: true,
        mutate: gitHookMocks.mutateBranch,
      });
    });

    it('hands off to the topic snapshot instead of collapsing', () => {
      render(
        <GitStatus
          isGithub
          agentId="agent-1"
          fallbackGit={fallbackGit}
          path="/tmp/lobehub-wt-subtask"
          sourcePath="/repo"
        />,
      );

      expect(screen.getByTestId('stale-git-snapshot')).toHaveAttribute(
        'data-branch',
        'feat/task-list-subtask-nesting',
      );
      expect(screen.queryByTestId('worktree-switcher')).not.toBeInTheDocument();
    });

    // Worktrees picked from the bar were persisted without a branch. The dead
    // worktree alone must still hand off, or the reset-to-source action vanishes
    // with the rest of the cluster and the conversation is stuck on a missing cwd.
    describe('snapshot that recorded only the worktree, no branch', () => {
      const branchless = { activeWorktree: '/tmp/lobehub-wt-subtask', isWorktree: true };
      const source = { branch: 'canary', current: false, path: '/repo' };

      const mockSourceListing = (listing: unknown[] | undefined) => {
        gitHookMocks.useFetchGitWorktrees.mockImplementation(
          (_deviceId: string | undefined, path?: string) => ({
            data: path === '/repo' ? listing : [],
            isConfirmed: true,
            mutate: gitHookMocks.mutateWorktrees,
          }),
        );
      };

      const renderBranchless = () =>
        render(
          <GitStatus
            isGithub
            agentId="agent-1"
            deviceId="device-1"
            fallbackGit={branchless}
            path="/tmp/lobehub-wt-subtask"
            sourcePath="/repo"
          />,
        );

      // Worktrees picked from the bar were persisted without a branch. Requiring
      // one collapsed the whole cluster — reset-to-source action included.
      it('hands off once the source repo no longer lists the worktree', () => {
        mockSourceListing([source]);

        renderBranchless();

        expect(screen.getByTestId('stale-git-snapshot')).toBeInTheDocument();
      });

      it('hands off when the source lists the worktree only as prunable', () => {
        mockSourceListing([
          source,
          { current: false, path: '/tmp/lobehub-wt-subtask', prunable: true },
        ]);

        renderBranchless();

        expect(screen.getByTestId('stale-git-snapshot')).toBeInTheDocument();
      });

      // A remote read that fails in transit on a device still marked online comes
      // back as empty as a deleted path; the server turns the failed listing into
      // `[]`. Neither proves the worktree is gone.
      it('does not condemn the worktree when the source listing failed', () => {
        mockSourceListing([]);

        const { container } = renderBranchless();

        expect(container).toBeEmptyDOMElement();
      });

      it('does not condemn a worktree the source still lists as live', () => {
        mockSourceListing([source, { current: false, path: '/tmp/lobehub-wt-subtask' }]);

        const { container } = renderBranchless();

        expect(container).toBeEmptyDOMElement();
      });
    });

    it('skips the linked-PR lookup, which has no directory to run `gh` in', () => {
      render(
        <GitStatus
          isGithub
          agentId="agent-1"
          fallbackGit={fallbackGit}
          path="/tmp/lobehub-wt-subtask"
        />,
      );

      expect(gitHookMocks.useFetchGitLinkedPR).toHaveBeenCalledWith(
        undefined,
        '/tmp/lobehub-wt-subtask',
        undefined,
        true,
      );
    });

    it('does not flash the dead-directory snapshot while the probe is still pending', () => {
      gitHookMocks.useFetchGitBranch.mockReturnValue({
        data: undefined,
        mutate: gitHookMocks.mutateBranch,
      });

      render(
        <GitStatus
          isGithub
          agentId="agent-1"
          fallbackGit={fallbackGit}
          path="/tmp/lobehub-wt-subtask"
        />,
      );

      expect(screen.queryByTestId('stale-git-snapshot')).not.toBeInTheDocument();
    });

    it('renders nothing when the topic carries no git snapshot either', () => {
      const { container } = render(
        <GitStatus isGithub agentId="agent-1" path="/tmp/lobehub-wt-subtask" />,
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('stops probing the directory it just declared gone', () => {
      render(
        <GitStatus
          isGithub
          agentId="agent-1"
          fallbackGit={fallbackGit}
          path="/tmp/lobehub-wt-subtask"
        />,
      );

      // Left enabled, the diff poll alone keeps shelling out to git every 10s
      // against a path that cannot be read.
      expect(gitHookMocks.useReviewPatches).toHaveBeenCalledWith(
        '/tmp/lobehub-wt-subtask',
        'unstaged',
        undefined,
        undefined,
        false,
      );
      expect(gitHookMocks.useFetchGitAheadBehind).toHaveBeenCalledWith(undefined, undefined);
      expect(gitHookMocks.useFetchGitWorktrees).toHaveBeenCalledWith(undefined, undefined);
    });

    // A remote device that is offline answers `undefined`, which the service
    // normalizes into the same empty shape a deleted directory produces. Reading
    // that as "gone" would tell the user a live worktree no longer exists — and
    // offer to drop the override pointing at it.
    it('does not read an unreachable device as a deleted directory', () => {
      deviceStoreMock.devices = [{ deviceId: 'device-1', online: false }];

      const { container } = render(
        <GitStatus
          isGithub
          agentId="agent-1"
          deviceId="device-1"
          fallbackGit={fallbackGit}
          path="/tmp/lobehub-wt-subtask"
        />,
      );

      expect(container).toBeEmptyDOMElement();
      // …and the reads stay enabled, so the cluster comes back on reconnect.
      expect(gitHookMocks.useFetchGitWorktrees).toHaveBeenCalledWith(
        'device-1',
        '/tmp/lobehub-wt-subtask',
      );
    });

    it('hands off once that same device is reachable again', () => {
      deviceStoreMock.devices = [{ deviceId: 'device-1', online: true }];

      render(
        <GitStatus
          isGithub
          agentId="agent-1"
          deviceId="device-1"
          fallbackGit={fallbackGit}
          path="/tmp/lobehub-wt-subtask"
        />,
      );

      expect(screen.getByTestId('stale-git-snapshot')).toBeInTheDocument();
    });
  });

  describe('probe still pending (cold load, nothing cached yet)', () => {
    const fallbackGit = {
      branch: 'feat/stale-first',
      github: {
        pullRequest: {
          number: 42,
          state: 'OPEN',
          title: 'Stale-first git chips',
          url: 'https://github.com/lobehub/lobehub/pull/42',
        },
      },
    };

    beforeEach(() => {
      gitHookMocks.useFetchGitBranch.mockReturnValue({
        data: undefined,
        mutate: gitHookMocks.mutateBranch,
      });
      gitHookMocks.useFetchGitLinkedPR.mockReturnValue({
        data: undefined,
        mutate: gitHookMocks.mutatePR,
      });
    });

    // Regression: the bar rendered nothing until the branch probe answered, so
    // the whole branch / PR cluster popped in after every reload even though the
    // topic already carried a persisted git snapshot.
    it('paints the persisted branch and PR snapshot instead of collapsing', () => {
      render(<GitStatus isGithub agentId="agent-1" fallbackGit={fallbackGit} path="/repo" />);

      expect(screen.getByText('feat/stale-first')).toBeInTheDocument();
      expect(screen.getByText('#42')).toBeInTheDocument();
      expect(screen.queryByTestId('stale-git-snapshot')).not.toBeInTheDocument();
    });

    it('stays empty when the topic carries no snapshot', () => {
      const { container } = render(<GitStatus isGithub agentId="agent-1" path="/repo" />);

      expect(container).toBeEmptyDOMElement();
    });
  });

  it('keeps the recorded PR chip while the linked-PR lookup for the same branch loads', () => {
    gitHookMocks.useFetchGitLinkedPR.mockReturnValue({
      data: undefined,
      mutate: gitHookMocks.mutatePR,
    });

    render(
      <GitStatus
        isGithub
        agentId="agent-1"
        path="/repo"
        fallbackGit={{
          branch: 'fix/remote-review',
          github: {
            pullRequest: { number: 7, state: 'OPEN', title: 'Remote review', url: 'https://x/7' },
          },
        }}
      />,
    );

    expect(screen.getByText('#7')).toBeInTheDocument();
  });

  it('drops the recorded PR chip once the live branch differs from the snapshot', () => {
    gitHookMocks.useFetchGitLinkedPR.mockReturnValue({
      data: undefined,
      mutate: gitHookMocks.mutatePR,
    });

    render(
      <GitStatus
        isGithub
        agentId="agent-1"
        path="/repo"
        fallbackGit={{
          branch: 'other-branch',
          github: {
            pullRequest: { number: 7, state: 'OPEN', title: 'Other', url: 'https://x/7' },
          },
        }}
      />,
    );

    expect(screen.queryByText('#7')).not.toBeInTheDocument();
  });

  it('keeps branch switching visible when worktrees are available', () => {
    gitHookMocks.useFetchGitWorktrees.mockReturnValue({
      data: [
        { branch: 'fix/remote-review', current: true, path: '/repo' },
        { branch: 'canary', current: false, path: '/repo-canary' },
      ],
      isConfirmed: true,
      mutate: gitHookMocks.mutateWorktrees,
    });

    render(<GitStatus isGithub agentId="agent-1" path="/repo" sourcePath="/repo" />);

    expect(screen.getByTestId('worktree-switcher')).toHaveAttribute('data-disabled', 'false');
    expect(screen.getByText('fix/remote-review')).toBeInTheDocument();
  });
});
