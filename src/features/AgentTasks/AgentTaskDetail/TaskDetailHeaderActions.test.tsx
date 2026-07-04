/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TaskDetailHeaderActions from './TaskDetailHeaderActions';

interface MenuItem {
  key?: string;
  label?: ReactNode;
  type?: string;
}

const mocks = vi.hoisted(() => ({
  activeWorkspaceId: 'ws-1' as string | undefined,
  confirmModal: vi.fn(),
  deleteTask: vi.fn(),
  dropdownItems: [] as MenuItem[],
  messageSuccess: vi.fn(),
  navigate: vi.fn(),
  taskState: {
    activeTaskId: 'T-1' as string | undefined,
    taskDetailMap: { 'T-1': { visibility: 'private' as 'private' | 'public' } } as Record<
      string,
      { visibility?: 'private' | 'public' }
    >,
  },
  transferItems: [
    { key: 'transfer-task', label: 'Transfer to...' },
    { key: 'copy-task', label: 'Copy to...' },
  ] as MenuItem[],
  updateTaskVisibility: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ title }: { title?: string }) => <button type="button">{title}</button>,
  DropdownMenu: ({ children, items }: { children?: ReactNode; items: MenuItem[] }) => {
    mocks.dropdownItems = items;
    return <>{children}</>;
  },
  Icon: () => <span />,
  copyToClipboard: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: (opts: unknown) => mocks.confirmModal(opts),
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: { success: mocks.messageSuccess },
    }),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => 'ws-slug',
}));

vi.mock('@/business/client/hooks/useTaskTransferMenuItem', () => ({
  useTaskTransferMenuItem: vi.fn(() => mocks.transferItems),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/hooks/useAppOrigin', () => ({
  useAppOrigin: () => 'https://example.com',
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      ...mocks.taskState,
      deleteTask: mocks.deleteTask,
      updateTaskVisibility: mocks.updateTaskVisibility,
    }),
}));

describe('TaskDetailHeaderActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dropdownItems = [];
    mocks.taskState.activeTaskId = 'T-1';
    mocks.taskState.taskDetailMap = { 'T-1': { visibility: 'private' } };
    mocks.activeWorkspaceId = 'ws-1';
  });

  it('includes task transfer and copy actions in the detail menu', () => {
    render(<TaskDetailHeaderActions />);

    expect(mocks.dropdownItems.map((item) => item?.key)).toContain('transfer-task');
    expect(mocks.dropdownItems.map((item) => item?.key)).toContain('copy-task');
  });

  it('shows "publish to workspace" only for private tasks inside a workspace', () => {
    render(<TaskDetailHeaderActions />);

    expect(mocks.dropdownItems.map((item) => item?.key)).toContain('publishToWorkspace');
  });

  it('hides "publish to workspace" once the task is already public', () => {
    mocks.taskState.taskDetailMap = { 'T-1': { visibility: 'public' } };
    render(<TaskDetailHeaderActions />);

    expect(mocks.dropdownItems.map((item) => item?.key)).not.toContain('publishToWorkspace');
  });

  it('hides "publish to workspace" in personal mode (no workspace)', () => {
    mocks.activeWorkspaceId = undefined;
    render(<TaskDetailHeaderActions />);

    expect(mocks.dropdownItems.map((item) => item?.key)).not.toContain('publishToWorkspace');
  });

  it('publish action opens a one-way confirmation modal', () => {
    render(<TaskDetailHeaderActions />);
    const publishItem = mocks.dropdownItems.find((i) => i?.key === 'publishToWorkspace') as
      { onClick?: () => void } | undefined;
    publishItem?.onClick?.();

    expect(mocks.confirmModal).toHaveBeenCalledTimes(1);
    const opts = mocks.confirmModal.mock.calls[0][0] as { okText: string; title: string };
    expect(opts.title).toBe('taskDetail.publishToWorkspace.confirmTitle');
    expect(opts.okText).toBe('taskDetail.publishToWorkspace.confirmOk');
  });
});
