import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { canGoNative } from '@/libs/contextMenu/canGoNative';

import { useAgentDropdownMenu } from './useDropdownMenu';

const mocks = vi.hoisted(() => ({
  canCreate: true,
  canEdit: true,
  canEditResource: false,
  canManageResource: false,
  canManage: false,
  confirmModal: vi.fn(),
  toastError: vi.fn(),
  activeWorkspaceId: 'workspace-1' as string | null,
  home: {
    duplicateAgent: vi.fn(),
    pinAgent: vi.fn(),
    refreshAgentList: vi.fn(),
    removeAgent: vi.fn(),
    toggleAgentLabel: vi.fn(),
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

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: mocks.confirmModal,
  toast: { error: mocks.toastError, success: vi.fn() },
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
    canManageResource: mocks.canManageResource,
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

vi.mock('@/features/HomeSidebar/Body/Agent/ModalProvider', () => ({
  useOptionalAgentModal: () => null,
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: { openAgentInNewWindow: typeof vi.fn }) => unknown) =>
    selector({ openAgentInNewWindow: mocks.openAgentInNewWindow }),
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: typeof mocks.home) => unknown) => selector(mocks.home),
}));

vi.mock('@/store/home/selectors', () => ({
  agentLabelSelectors: {
    allLabels: () => [],
  },
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
    mocks.canManageResource = false;
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

  it('shows the Labels submenu only where it is enabled (the agents list page)', () => {
    const { result } = renderHook(() =>
      useAgentDropdownMenu({
        anchor: null,
        group: undefined,
        id: 'agent-1',
        labelsEnabled: true,
        openCreateGroupModal: vi.fn(),
        pinned: false,
        title: 'Public Agent',
        userId: 'creator-1',
        visibility: 'public',
      }),
    );

    expect(getMenuKeys(result.current())).toContain('labels');
  });

  it('offers the Labels submenu on an agent the member cannot configure', () => {
    // Labelling is list organization, not configuration: a member with
    // view-only access to a teammate's public agent may still tag it, and the
    // server agrees (role scope only, no per-resource check).
    mocks.canEditResource = false;

    const { result } = renderHook(() =>
      useAgentDropdownMenu({
        anchor: null,
        group: undefined,
        id: 'agent-1',
        labelsEnabled: true,
        openCreateGroupModal: vi.fn(),
        pinned: false,
        title: 'Public Agent',
        userId: 'creator-1',
        visibility: 'public',
      }),
    );

    expect(getMenuKeys(result.current())).toContain('labels');
  });

  it('hides the Labels submenu from a viewer', () => {
    // The viewer role holds no `agent:update` grant, so the server refuses —
    // this is the line labelling still respects.
    mocks.canEdit = false;

    const { result } = renderHook(() =>
      useAgentDropdownMenu({
        anchor: null,
        group: undefined,
        id: 'agent-1',
        labelsEnabled: true,
        openCreateGroupModal: vi.fn(),
        pinned: false,
        title: 'Public Agent',
        userId: 'creator-1',
        visibility: 'public',
      }),
    );

    expect(getMenuKeys(result.current())).not.toContain('labels');
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

  it('tells the user to wait when delete is refused by a pending history migration', async () => {
    // Regression: a 409 TRANSFER_IN_PROGRESS used to fall through to the
    // generic "operation failed, please try again", which invited immediate
    // retries that could never succeed until the backfill drained.
    mocks.canEditResource = true;
    mocks.canManage = true;
    mocks.home.removeAgent.mockRejectedValueOnce(
      Object.assign(new Error('migrating'), {
        data: { code: 'CONFLICT', errorData: { code: 'TRANSFER_IN_PROGRESS' }, httpStatus: 409 },
      }),
    );

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

    const deleteItem = (result.current() ?? []).find(
      (item) => item && typeof item === 'object' && 'key' in item && item.key === 'delete',
    ) as { onClick: (info: { domEvent: { stopPropagation: () => void } }) => void } | undefined;
    if (!deleteItem) throw new Error('Expected delete menu item');

    deleteItem.onClick({ domEvent: { stopPropagation: vi.fn() } });
    const { onOk } = mocks.confirmModal.mock.calls[0][0] as { onOk: () => Promise<void> };
    await onOk();

    expect(mocks.toastError).toHaveBeenCalledWith('deleteHistoryMigrating');
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
    mocks.canManageResource = true;
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

  it('hides the Permission shortcut from a non-author member who can configure the agent', () => {
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

    expect(getMenuKeys(result.current())).not.toContain('permission');
  });

  it('offers the Permission shortcut to the creator or a workspace owner', () => {
    mocks.canEditResource = true;
    mocks.canManageResource = true;

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
