import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { canGoNative } from '@/libs/contextMenu/canGoNative';

import { useAgentDropdownMenu } from './useDropdownMenu';

const mocks = vi.hoisted(() => ({
  canCreate: true,
  canEdit: true,
  canEditResource: false,
  canManage: false,
  activeWorkspaceId: 'workspace-1' as string | null,
  home: {
    duplicateAgent: vi.fn(),
    pinAgent: vi.fn(),
    refreshAgentList: vi.fn(),
    removeAgent: vi.fn(),
    updateAgentGroup: vi.fn(),
  },
  navigate: vi.fn(),
  openAgentInNewWindow: vi.fn(),
  setSidebarItemVisible: vi.fn(),
  transferMenuItems: null as null | { key: string; label: string }[],
}));

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    App: Object.assign(actual.App as object, {
      useApp: () => ({
        message: { error: vi.fn(), success: vi.fn() },
      }),
    }),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock('@/business/client/hooks/useAgentTransferMenuItem', () => ({
  useAgentTransferMenuItem: () => mocks.transferMenuItems,
}));

vi.mock('@/features/EditingPopover/store', () => ({ openEditingPopover: vi.fn() }));

vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => ({
    canEditResource: mocks.canEditResource,
    isAccessResolved: true,
  }),
}));

vi.mock('@/features/VisibilityConfirmContent', () => ({ default: () => null }));

vi.mock('../../useSidebarItemVisibility', () => ({
  useSidebarItemVisibility: () => ({
    isSidebarItemVisible: () => true,
    setSidebarItemVisible: mocks.setSidebarItemVisible,
  }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: 'create_content' | 'edit_own_content') => ({
    allowed: action === 'create_content' ? mocks.canCreate : mocks.canEdit,
    reason: '',
  }),
}));

vi.mock('@/hooks/useResourceManageable', () => ({
  useResourceManageable: () => mocks.canManage,
}));

vi.mock('@/services/agent', () => ({ agentService: {} }));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: { openAgentInNewWindow: typeof vi.fn }) => unknown) =>
    selector({ openAgentInNewWindow: mocks.openAgentInNewWindow }),
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: typeof mocks.home) => unknown) => selector(mocks.home),
}));

vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: {
    agentGroups: () => [],
    privateAgentGroups: () => [],
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { userId: string }) => unknown) =>
    selector({ userId: 'member-1' }),
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userId: (state: { userId: string }) => state.userId },
}));

vi.mock('../../../../hooks', () => ({ useRevealSidebarSection: () => vi.fn() }));

const getMenuKeys = (items: ReturnType<ReturnType<typeof useAgentDropdownMenu>>) =>
  (items ?? []).flatMap((item) =>
    item && typeof item === 'object' && 'key' in item && item.key ? [item.key] : [],
  );

const getMenuLayout = (items: ReturnType<ReturnType<typeof useAgentDropdownMenu>>) =>
  (items ?? []).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    if ('type' in item && item.type === 'divider') return ['divider'];
    if ('key' in item && item.key) return [item.key];
    return [];
  });

describe('useAgentDropdownMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeWorkspaceId = 'workspace-1';
    mocks.canCreate = true;
    mocks.canEdit = true;
    mocks.canEditResource = false;
    mocks.canManage = false;
    mocks.transferMenuItems = null;
  });

  it('keeps non-config actions available to a use-only Workspace member', () => {
    const { result } = renderHook(() =>
      useAgentDropdownMenu({
        anchor: null,
        group: undefined,
        id: 'agent-1',
        openCreateGroupModal: vi.fn(),
        pinned: false,
        title: 'Public Agent',
        userId: 'creator-1',
        visibility: 'public',
      }),
    );

    expect(getMenuKeys(result.current())).toEqual([
      'pin',
      'hideFromSidebar',
      'openInNewWindow',
      'duplicate',
      'moveGroup',
    ]);
  });

  it('keeps write actions hidden from a Workspace viewer', () => {
    mocks.canCreate = false;
    mocks.canEdit = false;

    const { result } = renderHook(() =>
      useAgentDropdownMenu({
        anchor: null,
        group: undefined,
        id: 'agent-1',
        openCreateGroupModal: vi.fn(),
        pinned: false,
        title: 'Public Agent',
        userId: 'creator-1',
        visibility: 'public',
      }),
    );

    expect(getMenuKeys(result.current())).toEqual(['hideFromSidebar', 'openInNewWindow']);
  });

  it('hides an Agent through the caller sidebar preference', async () => {
    const { result } = renderHook(() =>
      useAgentDropdownMenu({
        anchor: null,
        group: undefined,
        id: 'agent-1',
        openCreateGroupModal: vi.fn(),
        pinned: false,
        title: 'Public Agent',
        userId: 'member-1',
        visibility: 'public',
      }),
    );

    const hideItem = (result.current() ?? []).find(
      (item) => item && typeof item === 'object' && item.key === 'hideFromSidebar',
    );
    if (!hideItem || !('onClick' in hideItem) || !hideItem.onClick) {
      throw new Error('Expected hide-from-sidebar menu item');
    }

    await hideItem.onClick({ domEvent: { stopPropagation: vi.fn() } } as never);

    expect(mocks.setSidebarItemVisible).toHaveBeenCalledWith('agent-1', false);
  });

  it('stays native-eligible (string labels only, including the Move to Category submenu)', () => {
    mocks.canEditResource = true;

    const { result } = renderHook(() =>
      useAgentDropdownMenu({
        anchor: null,
        group: undefined,
        id: 'agent-1',
        openCreateGroupModal: vi.fn(),
        pinned: false,
        title: 'Public Agent',
        userId: 'member-1',
        visibility: 'public',
      }),
    );

    expect(canGoNative(result.current() ?? [])).toBe(true);
  });

  it('groups display, organization, access, and destructive actions by intent', () => {
    mocks.canEditResource = true;
    mocks.canManage = true;
    mocks.transferMenuItems = [{ key: 'copy-agent', label: 'Copy to…' }];

    const { result } = renderHook(() =>
      useAgentDropdownMenu({
        anchor: null,
        group: undefined,
        id: 'agent-1',
        openCreateGroupModal: vi.fn(),
        pinned: false,
        title: 'Public Agent',
        userId: 'member-1',
        visibility: 'public',
      }),
    );

    expect(getMenuLayout(result.current())).toEqual([
      'pin',
      'hideFromSidebar',
      'openInNewWindow',
      'divider',
      'rename',
      'duplicate',
      'moveGroup',
      'copy-agent',
      'divider',
      'permission',
      'makePrivate',
      'divider',
      'delete',
    ]);
  });

  it('offers the Permission shortcut to a member who can configure the agent', () => {
    mocks.canEditResource = true;

    const { result } = renderHook(() =>
      useAgentDropdownMenu({
        anchor: null,
        group: undefined,
        id: 'agent-1',
        openCreateGroupModal: vi.fn(),
        pinned: false,
        title: 'Public Agent',
        userId: 'member-1',
        visibility: 'public',
      }),
    );

    const permissionItem = (result.current() ?? []).find(
      (item) => item && typeof item === 'object' && 'key' in item && item.key === 'permission',
    ) as { onClick: (info: { domEvent: { stopPropagation: () => void } }) => void } | undefined;

    expect(permissionItem).toBeTruthy();

    permissionItem?.onClick({ domEvent: { stopPropagation: vi.fn() } });

    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agent-1/permission');
  });

  it('hides the Permission shortcut in personal mode — there are no members to scope', () => {
    mocks.activeWorkspaceId = null;
    mocks.canEditResource = true;

    const { result } = renderHook(() =>
      useAgentDropdownMenu({
        anchor: null,
        group: undefined,
        id: 'agent-1',
        openCreateGroupModal: vi.fn(),
        pinned: false,
        title: 'Personal Agent',
        userId: 'member-1',
        visibility: 'private',
      }),
    );

    expect(getMenuKeys(result.current())).not.toContain('permission');
  });
});
