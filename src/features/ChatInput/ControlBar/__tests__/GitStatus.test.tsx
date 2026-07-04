import { fireEvent, render, screen } from '@testing-library/react';
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
  mutateWorkingTreeStatus: vi.fn(),
  mutateWorktrees: vi.fn(),
  useFetchGitAheadBehind: vi.fn(),
  useFetchGitBranch: vi.fn(),
  useFetchGitLinkedPR: vi.fn(),
  useFetchGitWorkingTreeStatus: vi.fn(),
  useFetchGitWorktrees: vi.fn(),
}));

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
  useFetchGitWorkingTreeStatus: gitHookMocks.useFetchGitWorkingTreeStatus,
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

vi.mock('@lobehub/ui/base-ui', () => ({
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
  gitHookMocks.useFetchGitWorkingTreeStatus.mockReturnValue({
    data: { added: 1, clean: false, deleted: 0, modified: 2, total: 3 },
    mutate: gitHookMocks.mutateWorkingTreeStatus,
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

    fireEvent.click(screen.getByRole('button'));

    expect(globalStoreMock.setWorkingSidebarTab).toHaveBeenCalledWith('review');
    expect(globalStoreMock.toggleRightPanel).toHaveBeenCalledWith(true);
  });
});
