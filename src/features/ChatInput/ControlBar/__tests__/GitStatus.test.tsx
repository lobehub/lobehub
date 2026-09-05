import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  useFetchGitAheadBehind: vi.fn(),
  useFetchGitBranch: vi.fn(),
  useFetchGitLinkedPR: vi.fn(),
  useReviewPatches: vi.fn(),
  useFetchGitWorktrees: vi.fn(),
}));

vi.mock('../BranchSwitcher', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../WorktreeSwitcher', () => ({
  default: () => <span data-testid="worktree-switcher" />,
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

vi.mock('@/components/AntdStaticMethods', () => ({
  message: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
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
      true,
    );
    expect(screen.getByText('+3')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();

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

    it('stays empty while the probe is still pending, so no stale flash', () => {
      gitHookMocks.useFetchGitBranch.mockReturnValue({
        data: undefined,
        mutate: gitHookMocks.mutateBranch,
      });

      const { container } = render(
        <GitStatus
          isGithub
          agentId="agent-1"
          fallbackGit={fallbackGit}
          path="/tmp/lobehub-wt-subtask"
        />,
      );

      expect(container).toBeEmptyDOMElement();
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
});
