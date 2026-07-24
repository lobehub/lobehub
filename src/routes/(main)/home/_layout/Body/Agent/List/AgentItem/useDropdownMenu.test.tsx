import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentDropdownMenu } from './useDropdownMenu';

const mocks = vi.hoisted(() => ({
  canCreate: true,
  canEdit: true,
  canEditResource: false,
  home: {
    duplicateAgent: vi.fn(),
    pinAgent: vi.fn(),
    refreshAgentList: vi.fn(),
    removeAgent: vi.fn(),
    updateAgentGroup: vi.fn(),
  },
  openAgentInNewWindow: vi.fn(),
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
  useActiveWorkspaceId: () => 'workspace-1',
}));

vi.mock('@/business/client/hooks/useAgentTransferMenuItem', () => ({
  useAgentTransferMenuItem: () => null,
}));

vi.mock('@/features/EditingPopover/store', () => ({ openEditingPopover: vi.fn() }));

vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => ({
    canEditResource: mocks.canEditResource,
    isAccessResolved: true,
  }),
}));

vi.mock('@/features/VisibilityConfirmContent', () => ({ default: () => null }));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: 'create_content' | 'edit_own_content') => ({
    allowed: action === 'create_content' ? mocks.canCreate : mocks.canEdit,
    reason: '',
  }),
}));

vi.mock('@/hooks/useResourceManageable', () => ({
  useResourceManageable: () => false,
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

describe('useAgentDropdownMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canCreate = true;
    mocks.canEdit = true;
    mocks.canEditResource = false;
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
      'duplicate',
      'openInNewWindow',
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

    expect(getMenuKeys(result.current())).toEqual(['openInNewWindow']);
  });
});
