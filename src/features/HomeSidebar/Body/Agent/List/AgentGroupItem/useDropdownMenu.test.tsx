import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGroupDropdownMenu } from './useDropdownMenu';

const mocks = vi.hoisted(() => ({
  activeWorkspaceId: null as string | null,
  canEdit: true,
  canEditResource: true,
  canManage: true,
  home: {
    duplicateAgentGroup: vi.fn(),
    pinAgentGroup: vi.fn(),
    removeAgentGroup: vi.fn(),
  },
  isSidebarItemVisible: vi.fn(() => true),
  isTeamPinned: false,
  openAgentInNewWindow: vi.fn(),
  setSidebarItemVisible: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: vi.fn(),
  toast: { error: mocks.toastError, success: vi.fn() },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock('@/business/client/hooks/useAgentGroupTransferMenuItem', () => ({
  useAgentGroupTransferMenuItem: () => null,
}));

vi.mock('@/business/client/hooks/useAgentGroupTransferToMemberMenuItem', () => ({
  useAgentGroupTransferToMemberMenuItem: () => null,
}));

vi.mock('@/features/EditingPopover/store', () => ({ openEditingPopover: vi.fn() }));

vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => ({ canEditResource: mocks.canEditResource, isAccessResolved: true }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.canEdit, reason: '' }),
}));

vi.mock('@/hooks/useResourceManageable', () => ({
  useResourceManageable: () => mocks.canManage,
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: { openAgentInNewWindow: typeof vi.fn }) => unknown) =>
    selector({ openAgentInNewWindow: mocks.openAgentInNewWindow }),
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: typeof mocks.home) => unknown) => selector(mocks.home),
}));

vi.mock('../../useSidebarItemVisibility', () => ({
  useSidebarItemVisibility: () => ({
    isSidebarItemVisible: mocks.isSidebarItemVisible,
    setSidebarItemVisible: mocks.setSidebarItemVisible,
  }),
}));

vi.mock('../../useSidebarPinMenuItems', () => ({
  useSidebarPinMenuItems: () => ({
    isTeamPinned: mocks.isTeamPinned,
    menuItems: mocks.activeWorkspaceId ? [{ key: 'pin', label: 'pin' }] : [],
  }),
}));

type MenuItems = ReturnType<ReturnType<typeof useGroupDropdownMenu>>;

const getMenuKeys = (items: MenuItems) =>
  (items ?? []).flatMap((item) =>
    item && typeof item === 'object' && 'key' in item && item.key ? [item.key] : [],
  );

const renderGroupMenu = (options: Partial<Parameters<typeof useGroupDropdownMenu>[0]> = {}) =>
  renderHook(() =>
    useGroupDropdownMenu({
      anchor: null,
      id: 'cg_1',
      pinned: false,
      title: 'Launch Team',
      userId: 'user-1',
      ...options,
    }),
  );

describe('useGroupDropdownMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeWorkspaceId = null;
    mocks.canEdit = true;
    mocks.canEditResource = true;
    mocks.canManage = true;
    mocks.isSidebarItemVisible.mockReturnValue(true);
    mocks.isTeamPinned = false;
  });

  it('hides a group through the caller sidebar preference, like an Agent row', async () => {
    const { result } = renderGroupMenu();

    const hideItem = (result.current() ?? []).find(
      (item) => item && typeof item === 'object' && 'key' in item && item.key === 'hideFromSidebar',
    );
    if (!hideItem || !('onClick' in hideItem) || !hideItem.onClick) {
      throw new Error('Expected hide-from-sidebar menu item');
    }

    await hideItem.onClick({ domEvent: { stopPropagation: vi.fn() } } as never);

    expect(mocks.setSidebarItemVisible).toHaveBeenCalledWith('cg_1', false);
    expect(mocks.isSidebarItemVisible).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cg_1', type: 'group' }),
    );
  });

  it('places the hide action right after pin', () => {
    const { result } = renderGroupMenu();

    expect(getMenuKeys(result.current()).slice(0, 3)).toEqual(['pin', 'hideFromSidebar', 'rename']);
  });

  it('offers hide to a member who cannot configure the group', () => {
    mocks.canEditResource = false;
    const { result } = renderGroupMenu();

    const keys = getMenuKeys(result.current());
    expect(keys).toContain('hideFromSidebar');
    expect(keys).not.toContain('rename');
  });

  it('reports a failed hide instead of failing silently', async () => {
    mocks.setSidebarItemVisible.mockRejectedValueOnce(new Error('offline'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderGroupMenu();

    const hideItem = (result.current() ?? []).find(
      (item) => item && typeof item === 'object' && 'key' in item && item.key === 'hideFromSidebar',
    ) as { onClick: (info: unknown) => Promise<void> };
    await hideItem.onClick({ domEvent: { stopPropagation: vi.fn() } });

    expect(mocks.toastError).toHaveBeenCalledWith('operationFailed');
    errorSpy.mockRestore();
  });

  it('omits hide for a group already hidden from the sidebar', () => {
    mocks.isSidebarItemVisible.mockReturnValue(false);
    const { result } = renderGroupMenu();

    expect(getMenuKeys(result.current())).not.toContain('hideFromSidebar');
  });

  it('omits hide for lists that ignore the sidebar preference', () => {
    const { result } = renderGroupMenu({ sidebarVisibilityEnabled: false });

    expect(getMenuKeys(result.current())).not.toContain('hideFromSidebar');
  });

  it('omits hide on a team-pinned workspace group, which every member sees', () => {
    mocks.activeWorkspaceId = 'workspace-1';
    mocks.isTeamPinned = true;
    const { result } = renderGroupMenu({ pinned: true, visibility: 'public' });

    expect(getMenuKeys(result.current())).not.toContain('hideFromSidebar');
  });
});
