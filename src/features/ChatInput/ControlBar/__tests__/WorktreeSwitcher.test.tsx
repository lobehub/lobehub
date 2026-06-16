import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WorktreeSwitcher from '../WorktreeSwitcher';

const commitMock = vi.hoisted(() => vi.fn());

vi.mock('../useCommitWorkingDirectory', () => ({
  useCommitWorkingDirectory: () => ({ commit: commitMock }),
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => <span data-testid="icon" />,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  DropdownMenuPopup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuPositioner: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuRoot: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
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
});

describe('WorktreeSwitcher', () => {
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

    fireEvent.click(screen.getByText('/repo'));

    expect(commitMock).toHaveBeenCalledWith({ path: '/repo', repoType: 'git' });
  });
});
