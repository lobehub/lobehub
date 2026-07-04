import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WorktreeSwitcher from '../WorktreeSwitcher';

const commitMock = vi.hoisted(() => vi.fn());
const confirmModalMock = vi.hoisted(() => vi.fn());
const messageErrorMock = vi.hoisted(() => vi.fn());
const messageSuccessMock = vi.hoisted(() => vi.fn());
const removeGitWorktreeMock = vi.hoisted(() => vi.fn());

vi.mock('../useCommitWorkingDirectory', () => ({
  useCommitWorkingDirectory: () => ({ commit: commitMock }),
}));

vi.mock('@/components/AntdStaticMethods', () => ({
  message: {
    error: messageErrorMock,
    success: messageSuccessMock,
  },
}));

vi.mock('@/services/git', () => ({
  gitService: {
    removeGitWorktree: removeGitWorktreeMock,
  },
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => <span data-testid="icon" />,
  Tooltip: ({ children }: { children: ReactNode }) => (
    <span data-testid="worktree-tooltip">{children}</span>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: confirmModalMock,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  DropdownMenuPopup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuPositioner: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuRoot: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className} data-testid="worktree-dropdown-trigger">
      {children}
    </div>
  ),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({}),
  cssVar: new Proxy({}, { get: () => 'var(--mock)' }),
  cx: (...classes: string[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

beforeEach(() => {
  commitMock.mockReset();
  confirmModalMock.mockReset();
  messageErrorMock.mockReset();
  messageSuccessMock.mockReset();
  removeGitWorktreeMock.mockReset();
  removeGitWorktreeMock.mockResolvedValue({ success: true });
});

describe('WorktreeSwitcher', () => {
  it('keeps the dropdown trigger anchored to a stable DOM wrapper', () => {
    render(
      <WorktreeSwitcher
        isGithub
        agentId="agent-1"
        currentBranch="feat/current"
        path="/repo"
        sourcePath="/repo"
        worktrees={[
          {
            branch: 'feat/current',
            current: true,
            path: '/repo',
            status: { added: 0, clean: true, deleted: 0, modified: 0, total: 0 },
          },
          {
            branch: 'canary',
            current: false,
            path: '/repo-canary',
            status: { added: 0, clean: true, deleted: 0, modified: 0, total: 0 },
          },
        ]}
      />,
    );

    const trigger = screen.getByTestId('worktree-dropdown-trigger');
    expect(trigger.firstElementChild?.tagName).toBe('DIV');
    expect(within(trigger).getByTestId('worktree-tooltip')).toBeTruthy();
  });

  it('renders dirty stats and omits clean labels in the worktree list', () => {
    render(
      <WorktreeSwitcher
        isGithub
        agentId="agent-1"
        currentBranch="feat/current"
        path="/repo"
        sourcePath="/repo"
        worktrees={[
          {
            branch: 'feat/current',
            current: true,
            path: '/repo',
            status: { added: 2, clean: false, deleted: 1, modified: 3, total: 6 },
          },
          {
            branch: 'canary',
            current: false,
            path: '/repo-canary',
            status: { added: 0, clean: true, deleted: 0, modified: 0, total: 0 },
          },
        ]}
      />,
    );

    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.getByText('±3')).toBeTruthy();
    expect(screen.getByText('-1')).toBeTruthy();
    expect(screen.getByText('+2').parentElement?.parentElement?.textContent).toBe('+2±3-1');
    expect(
      screen.getByText('workingDirectory.currentWorktree').parentElement?.textContent,
    ).toContain('feat/current');
    expect(screen.queryByText('workingDirectory.clean')).toBeNull();
  });

  it('shows worktree paths relative to the source path except temp paths', () => {
    render(
      <WorktreeSwitcher
        isGithub
        agentId="agent-1"
        currentBranch="feat/current"
        path="/Users/me/projects/project"
        sourcePath="/Users/me/projects/project"
        worktrees={[
          {
            branch: 'feat/current',
            current: true,
            path: '/Users/me/projects/project',
            status: { added: 0, clean: true, deleted: 0, modified: 0, total: 0 },
          },
          {
            branch: 'canary',
            current: false,
            path: '/Users/me/projects/project-fix',
            status: { added: 0, clean: true, deleted: 0, modified: 0, total: 0 },
          },
          {
            branch: 'scratch',
            current: false,
            path: '/tmp/project-scratch',
            status: { added: 0, clean: true, deleted: 0, modified: 0, total: 0 },
          },
        ]}
      />,
    );

    expect(screen.getByText('/Users/me/projects/project')).toBeTruthy();
    expect(screen.getByText('../project-fix')).toBeTruthy();
    expect(screen.getByText('/tmp/project-scratch')).toBeTruthy();
  });

  it('confirms and removes a non-current worktree', async () => {
    const onWorktreesChange = vi.fn();
    render(
      <WorktreeSwitcher
        isGithub
        agentId="agent-1"
        currentBranch="feat/current"
        deviceId="device-1"
        path="/repo"
        sourcePath="/repo"
        worktrees={[
          {
            branch: 'feat/current',
            current: true,
            path: '/repo',
            status: { added: 0, clean: true, deleted: 0, modified: 0, total: 0 },
          },
          {
            current: false,
            detached: true,
            head: '4f46abcdef',
            path: '/repo-detached',
            status: { added: 0, clean: true, deleted: 0, modified: 0, total: 0 },
          },
          {
            branch: 'canary',
            current: false,
            path: '/repo-canary',
            status: { added: 0, clean: true, deleted: 0, modified: 0, total: 0 },
          },
        ]}
        onWorktreesChange={onWorktreesChange}
      />,
    );

    // both the detached and the branch worktree are removable; only the current one is not
    const removeButtons = screen.getAllByLabelText('workingDirectory.removeWorktreeAction');
    expect(removeButtons).toHaveLength(2);

    fireEvent.click(removeButtons[0]);

    expect(commitMock).not.toHaveBeenCalled();
    expect(confirmModalMock).toHaveBeenCalledTimes(1);

    await confirmModalMock.mock.calls[0][0].onOk();

    expect(removeGitWorktreeMock).toHaveBeenCalledWith({
      deviceId: 'device-1',
      path: '/repo',
      worktreePath: '/repo-detached',
    });
    expect(onWorktreesChange).toHaveBeenCalled();
    expect(messageSuccessMock).toHaveBeenCalledWith('workingDirectory.removeWorktreeSuccess');
    expect(messageErrorMock).not.toHaveBeenCalled();
  });

  it('commits the selected worktree path as the working directory', () => {
    render(
      <WorktreeSwitcher
        isGithub
        agentId="agent-1"
        currentBranch="feat/current"
        path="/repo"
        sourcePath="/repo"
        worktrees={[
          {
            branch: 'feat/current',
            current: true,
            path: '/repo',
            status: { added: 1, clean: false, deleted: 0, modified: 0, total: 1 },
          },
          {
            branch: 'canary',
            current: false,
            path: '/repo-canary',
            status: { added: 0, clean: true, deleted: 0, modified: 0, total: 0 },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByText('/repo-canary'));

    expect(commitMock).toHaveBeenCalledWith({
      git: { activeWorktree: '/repo-canary' },
      path: '/repo',
      repoType: 'github',
    });
  });

  it('clears the active worktree when selecting the source worktree', () => {
    render(
      <WorktreeSwitcher
        agentId="agent-1"
        currentBranch="feat/current"
        isGithub={false}
        path="/repo-canary"
        sourcePath="/repo"
        worktrees={[
          {
            branch: 'feat/current',
            current: false,
            path: '/repo',
            status: { added: 0, clean: true, deleted: 0, modified: 0, total: 0 },
          },
          {
            branch: 'canary',
            current: true,
            path: '/repo-canary',
            status: { added: 0, clean: true, deleted: 0, modified: 0, total: 0 },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByTitle('/repo'));

    expect(commitMock).toHaveBeenCalledWith({ path: '/repo', repoType: 'git' });
  });
});
