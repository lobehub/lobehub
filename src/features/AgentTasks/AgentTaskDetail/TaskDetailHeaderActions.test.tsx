/**
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TaskDetailHeaderActions from './TaskDetailHeaderActions';

interface MenuItem {
  key?: string;
  label?: ReactNode;
  type?: string;
}

const mocks = vi.hoisted(() => ({
  /** Subscribers of the mocked task store, so a state change re-renders like zustand. */
  storeListeners: new Set<() => void>(),
  storeVersion: 0,
  toastInfo: vi.fn(),
  activeWorkspaceId: 'ws-1' as string | undefined,
  archiveTask: vi.fn(),
  confirmModal: vi.fn(),
  currentUserId: 'user-1' as string | undefined,
  deleteTask: vi.fn(),
  dropdownItems: [] as MenuItem[],
  isWorkspaceOwner: false,
  messageSuccess: vi.fn(),
  navigate: vi.fn(),
  taskState: {
    activeTaskId: 'T-1' as string | undefined,
    taskDetailMap: {
      'T-1': { visibility: 'private' as 'private' | 'public' },
    } as Record<
      string,
      {
        archivedAt?: string | null;
        createdByUserId?: string | null;
        status?: string;
        visibility?: 'private' | 'public';
      }
    >,
  },
  transferItems: [
    { key: 'transfer-task', label: 'Move to…' },
    { key: 'copy-task', label: 'Copy to...' },
  ] as MenuItem[],
  updateTaskVisibility: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const factories: ((original: typeof importOriginal) => unknown)[] = [
    async (importOriginal) => ({
      ...(await importOriginal<object>()),
      DropdownMenu: ({ children, items }: { children?: ReactNode; items: MenuItem[] }) => {
        mocks.dropdownItems = items;
        return <>{children}</>;
      },
      copyToClipboard: vi.fn(),
    }),
    async (importOriginal) => ({
      ...(await importOriginal<object>()),
      confirmModal: (opts: unknown) => mocks.confirmModal(opts),
      toast: { error: vi.fn(), info: mocks.toastInfo, success: vi.fn() },
    }),
  ];
  const merged: Record<string, unknown> = { ...actual };
  for (const factory of factories) {
    const part = (await factory(importOriginal)) as Record<string, unknown>;
    for (const [key, value] of Object.entries(part)) if (value !== actual[key]) merged[key] = value;
  }
  return merged;
});

vi.mock('antd', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  App: {
    useApp: () => ({
      message: { success: mocks.messageSuccess },
    }),
  },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => 'ws-slug',
}));

vi.mock('@/business/client/hooks/useIsWorkspaceOwner', () => ({
  useIsWorkspaceOwner: () => mocks.isWorkspaceOwner,
}));

vi.mock('@/features/Favorites', () => ({
  FavoriteButton: () => null,
  useCurrentFavoritePath: () => '/favorite-path',
  useFavoriteMenuItem: () => null,
}));
vi.mock('@/features/VisibilityConfirmContent', () => ({
  default: () => <div />,
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: {
    userId: () => mocks.currentUserId,
  },
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

vi.mock('@/store/task', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => {
    mocks.storeListeners.add(listener);
    return () => mocks.storeListeners.delete(listener);
  };
  return {
    useTaskStore: (selector: (state: Record<string, unknown>) => unknown) => {
      useSyncExternalStore(subscribe, () => mocks.storeVersion);
      return selector({
        ...mocks.taskState,
        archiveTask: mocks.archiveTask,
        deleteTask: mocks.deleteTask,
        updateTaskVisibility: mocks.updateTaskVisibility,
      });
    },
  };
});

const setTaskDetailMap = (map: typeof mocks.taskState.taskDetailMap) =>
  act(() => {
    mocks.taskState.taskDetailMap = map;
    mocks.storeVersion += 1;
    mocks.storeListeners.forEach((listener) => listener());
  });

describe('TaskDetailHeaderActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dropdownItems = [];
    mocks.taskState.activeTaskId = 'T-1';
    mocks.taskState.taskDetailMap = { 'T-1': { visibility: 'private' } };
    mocks.activeWorkspaceId = 'ws-1';
    mocks.currentUserId = 'user-1';
    mocks.isWorkspaceOwner = false;
  });

  it('lists copy content right below copy link, ahead of the transfer group', () => {
    render(<TaskDetailHeaderActions />);

    expect(mocks.dropdownItems.slice(0, 6).map((item) => item?.key ?? item?.type)).toEqual([
      'copyId',
      'copyLink',
      'copyContent',
      'divider',
      'transfer-task',
      'copy-task',
    ]);
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

  it('shows "make private" on public tasks for the creator', () => {
    mocks.taskState.taskDetailMap = {
      'T-1': { createdByUserId: 'user-1', visibility: 'public' },
    };
    render(<TaskDetailHeaderActions />);

    expect(mocks.dropdownItems.map((item) => item?.key)).toContain('makePrivate');
  });

  it('offers a non-creator member to take the public task over as private', () => {
    mocks.taskState.taskDetailMap = {
      'T-1': { createdByUserId: 'someone-else', visibility: 'public' },
    };
    render(<TaskDetailHeaderActions />);
    const item = mocks.dropdownItems.find((i) => i?.key === 'makePrivate') as
      { label?: string; onClick?: () => void } | undefined;
    expect(item?.label).toBe('taskDetail.takeOver.menuLabel');
    item?.onClick?.();

    const opts = mocks.confirmModal.mock.calls[0][0] as {
      okButtonProps?: { danger?: boolean };
      onOk: () => Promise<void>;
      title: string;
    };
    expect(opts.title).toBe('taskDetail.takeOver.confirmTitle');
    expect(opts.okButtonProps?.danger).toBe(true);
    return opts.onOk().then(() => {
      expect(mocks.updateTaskVisibility).toHaveBeenCalledWith('T-1', 'private', {
        takeOwnership: true,
      });
    });
  });

  it('hides "make private" on private tasks', () => {
    mocks.taskState.taskDetailMap = {
      'T-1': { createdByUserId: 'user-1', visibility: 'private' },
    };
    render(<TaskDetailHeaderActions />);

    expect(mocks.dropdownItems.map((item) => item?.key)).not.toContain('makePrivate');
  });

  it('make-private action opens a destructive confirmation and updates visibility', () => {
    mocks.taskState.taskDetailMap = {
      'T-1': { createdByUserId: 'user-1', visibility: 'public' },
    };
    render(<TaskDetailHeaderActions />);
    const item = mocks.dropdownItems.find((i) => i?.key === 'makePrivate') as
      { onClick?: () => void } | undefined;
    item?.onClick?.();

    expect(mocks.confirmModal).toHaveBeenCalledTimes(1);
    const opts = mocks.confirmModal.mock.calls[0][0] as {
      okButtonProps?: { danger?: boolean };
      onOk: () => Promise<void>;
      title: string;
    };
    expect(opts.title).toBe('makePrivate.confirm.title');
    expect(opts.okButtonProps?.danger).toBe(true);
    return opts.onOk().then(() => {
      expect(mocks.updateTaskVisibility).toHaveBeenCalledWith('T-1', 'private');
    });
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

  it('moves archive out of the menu into a header button left of the menu', () => {
    render(<TaskDetailHeaderActions />);

    expect(mocks.dropdownItems.map((item) => item?.key)).not.toContain('archive');
    const button = screen.getByRole('button', { name: 'taskList.contextMenu.archive' });
    const moreButton = screen.getAllByRole('button').at(-1);
    expect(button).not.toBe(moreButton);
    expect(
      button.compareDocumentPosition(moreButton!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps a single divider between groups once archive leaves the menu', () => {
    render(<TaskDetailHeaderActions />);

    const kinds = mocks.dropdownItems.map((item) => item?.key ?? item?.type);
    expect(kinds.slice(-2)).toEqual(['divider', 'delete']);
    kinds.forEach((kind, index) => {
      if (kind === 'divider') expect(kinds[index + 1]).not.toBe('divider');
    });
  });

  it('archives the task from the header button', async () => {
    render(<TaskDetailHeaderActions />);

    expect(
      screen.getByRole('button', { name: 'taskList.contextMenu.archive' }),
    ).not.toHaveAttribute('aria-disabled');

    fireEvent.click(screen.getByRole('button', { name: 'taskList.contextMenu.archive' }));

    await waitFor(() => expect(mocks.archiveTask).toHaveBeenCalledWith('T-1', true));
  });

  it('restores an archived task from the same button', async () => {
    mocks.taskState.taskDetailMap = {
      'T-1': { archivedAt: '2026-11-01T00:00:00.000Z', visibility: 'private' },
    };
    render(<TaskDetailHeaderActions />);

    fireEvent.click(screen.getByRole('button', { name: 'taskList.contextMenu.unarchive' }));

    await waitFor(() => expect(mocks.archiveTask).toHaveBeenCalledWith('T-1', false));
  });

  // ActionIcon styles `[aria-disabled="true"]` with `pointer-events: none`, which
  // swallows the hover that shows the reason and, when left behind, every click.
  it('keeps a blocked button hoverable and answers a click with the reason', () => {
    mocks.taskState.taskDetailMap = { 'T-1': { status: 'running', visibility: 'private' } };
    render(<TaskDetailHeaderActions />);

    const button = screen.getByRole('button', { name: 'taskList.contextMenu.archive' });
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-description', 'taskList.contextMenu.archiveBlocked');
    expect(button).toHaveStyle({ cursor: 'not-allowed' });
    fireEvent.click(button);

    expect(mocks.archiveTask).not.toHaveBeenCalled();
    expect(mocks.toastInfo).toHaveBeenCalledWith('taskList.contextMenu.archiveBlocked');
  });

  // Locks the behavior, not the production trigger: happy-dom ignores
  // `pointer-events`, and the stale attribute never reproduced here.
  it('lets the same mounted button archive once the running task completes', async () => {
    mocks.taskState.taskDetailMap = { 'T-1': { status: 'running', visibility: 'private' } };
    render(<TaskDetailHeaderActions />);

    setTaskDetailMap({ 'T-1': { status: 'completed', visibility: 'private' } });

    const button = screen.getByRole('button', { name: 'taskList.contextMenu.archive' });
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).not.toHaveAttribute('aria-description');
    fireEvent.click(button);

    await waitFor(() => expect(mocks.archiveTask).toHaveBeenCalledWith('T-1', true));
  });
});
