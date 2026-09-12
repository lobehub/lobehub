import type { DeviceGitPullRequestDetail } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MergeDock from '../MergeDock';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/services/electron/system', () => ({
  electronSystemService: { openExternalLink: vi.fn() },
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  Checkbox: ({
    checked,
    children,
    onChange,
  }: {
    checked?: boolean;
    children?: ReactNode;
    onChange?: (checked: boolean) => void;
  }) => (
    <label>
      <input
        checked={checked}
        data-testid={'bypass'}
        type={'checkbox'}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      {children}
    </label>
  ),
  DropdownMenu: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const makeDetail = (
  overrides: Partial<DeviceGitPullRequestDetail> = {},
): DeviceGitPullRequestDetail => ({
  additions: 10,
  author: 'innei',
  autoMerge: null,
  baseRefName: 'main',
  body: '',
  changedFiles: 2,
  checks: [{ name: 'ci', required: true, status: 'failure' }],
  comments: [],
  commits: [{ author: 'innei', committedAt: '2026-09-13T00:00:00Z', message: 'fix', sha: 'abc' }],
  deletions: 2,
  headRefName: 'feat/x',
  isDraft: false,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'BLOCKED',
  number: 1,
  repo: { name: 'lobe-chat', owner: 'lobehub' },
  reviewDecision: 'APPROVED',
  reviews: [],
  state: 'open',
  title: 'PR',
  url: 'https://github.com/lobehub/lobe-chat/pull/1',
  viewerCanBypass: true,
  viewerCanWrite: true,
  ...overrides,
});

const renderDock = (detail: DeviceGitPullRequestDetail, busy?: 'merge') => {
  const onAction = vi.fn().mockResolvedValue(true);
  render(
    <MergeDock
      busy={busy}
      detail={detail}
      onAction={onAction}
      onDismissError={vi.fn()}
      onPush={vi.fn()}
      onRetry={vi.fn()}
    />,
  );
  return onAction;
};

describe('MergeDock', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('ticking bypass turns the action red and merges with admin', () => {
    const onAction = renderDock(makeDetail());
    expect(screen.getByTestId('pr-primary-action')).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(screen.getByTestId('bypass'));

    const button = screen.getByTestId('pr-primary-action');
    expect(button).toHaveAttribute('data-tone', 'error');
    expect(button.textContent).toContain('workingPanel.pr.action.bypassSuffix');

    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledWith({ admin: true, method: 'squash', type: 'merge' });
  });

  it('does not re-run the action while busy', () => {
    const onAction = renderDock(makeDetail({ mergeStateStatus: 'CLEAN' }), 'merge');
    const button = screen.getByTestId('pr-primary-action');
    expect(button.textContent).toBe('workingPanel.pr.action.merging');

    fireEvent.click(button);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('renders no action for read-only viewers', () => {
    renderDock(makeDetail({ viewerCanWrite: false }));
    expect(screen.queryByTestId('pr-primary-action')).toBeNull();
    expect(screen.queryByTestId('bypass')).toBeNull();
    expect(screen.getByText('workingPanel.pr.hint.readOnly')).toBeTruthy();
  });

  it('uses the persisted merge method', () => {
    window.localStorage.setItem('lobechat-pr-merge-method', 'rebase');
    const onAction = renderDock(makeDetail({ mergeStateStatus: 'CLEAN' }));

    fireEvent.click(screen.getByTestId('pr-primary-action'));
    expect(onAction).toHaveBeenCalledWith({ admin: false, method: 'rebase', type: 'merge' });
  });
});
