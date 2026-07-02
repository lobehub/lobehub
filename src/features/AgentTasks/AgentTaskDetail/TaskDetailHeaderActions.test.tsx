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
  deleteTask: vi.fn(),
  dropdownItems: [] as MenuItem[],
  messageSuccess: vi.fn(),
  modalConfirm: vi.fn(),
  navigate: vi.fn(),
  taskState: {
    activeTaskId: 'T-1' as string | undefined,
    taskDetailMap: {} as Record<string, unknown>,
  },
  transferItems: [
    { key: 'transfer-task', label: 'Transfer to...' },
    { key: 'copy-task', label: 'Copy to...' },
  ] as MenuItem[],
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

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: { success: mocks.messageSuccess },
      modal: { confirm: mocks.modalConfirm },
    }),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
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
  useTaskStore: (
    selector: (state: { activeTaskId?: string; deleteTask: typeof mocks.deleteTask }) => unknown,
  ) => selector({ ...mocks.taskState, deleteTask: mocks.deleteTask }),
}));

describe('TaskDetailHeaderActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dropdownItems = [];
    mocks.taskState.activeTaskId = 'T-1';
  });

  it('includes task transfer and copy actions in the detail menu', () => {
    render(<TaskDetailHeaderActions />);

    expect(mocks.dropdownItems.map((item) => item?.key)).toContain('transfer-task');
    expect(mocks.dropdownItems.map((item) => item?.key)).toContain('copy-task');
  });
});
