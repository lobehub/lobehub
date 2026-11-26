/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentActionsDropdownMenu } from './useDropdownMenu';

const updateSystemStatusMock = vi.hoisted(() => vi.fn());
const workspaceIdMock = vi.hoisted(() => ({ current: undefined as string | undefined }));
const createSessionGroupMenuItemMock = vi.hoisted(() =>
  vi.fn((options?: { visibility?: 'private' | 'public' }) => ({
    key: options?.visibility === 'private' ? 'addPrivateSessionGroup' : 'addSessionGroup',
  })),
);

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => workspaceIdMock.current,
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => null,
}));

vi.mock('@/features/HomeSidebar/Body/CustomizeSidebarModal', () => ({
  openCustomizeSidebarModal: vi.fn(),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      agentPageSize: 10,
      updateSystemStatus: updateSystemStatusMock,
    }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    agentPageSize: (state: { agentPageSize: number }) => state.agentPageSize,
  },
}));

vi.mock('../../hooks', () => ({
  useCreateMenuItems: () => ({
    configMenuItem: (onOpenConfig: () => void) => ({
      key: 'config',
      label: 'sessionGroup.manageCategory',
      onClick: onOpenConfig,
    }),
    createSessionGroupMenuItem: createSessionGroupMenuItemMock,
  }),
}));

const menuKeys = (items: unknown[]) =>
  items.flatMap((item) =>
    item && typeof item === 'object' && 'key' in item && item.key ? [item.key] : [],
  );

describe('useAgentActionsDropdownMenu', () => {
  beforeEach(() => {
    workspaceIdMock.current = undefined;
    createSessionGroupMenuItemMock.mockClear();
  });

  it('omits section reordering from the Agent category header', () => {
    const { result } = renderHook(() =>
      useAgentActionsDropdownMenu({ openConfigGroupModal: vi.fn() }),
    );

    const keys = menuKeys(result.current);

    expect(keys).toEqual(['addSessionGroup', 'config', 'show', 'customizeSidebar']);
    expect(keys).not.toContain('moveUp');
    expect(keys).not.toContain('moveDown');
  });

  // Regression: the workspace menu used to append "New private category" /
  // "Manage private categories" next to the generic pair.
  it('keeps the personal-space entries in a workspace and creates private categories', () => {
    workspaceIdMock.current = 'ws-1';
    const openConfigGroupModal = vi.fn();
    const { result } = renderHook(() => useAgentActionsDropdownMenu({ openConfigGroupModal }));

    expect(menuKeys(result.current)).toEqual([
      'addPrivateSessionGroup',
      'config',
      'show',
      'customizeSidebar',
    ]);
    expect(createSessionGroupMenuItemMock).toHaveBeenCalledTimes(1);
    expect(createSessionGroupMenuItemMock).toHaveBeenCalledWith({ visibility: 'private' });

    const config = result.current.find(
      (item) => item && typeof item === 'object' && 'key' in item && item.key === 'config',
    ) as { onClick: () => void };
    config.onClick();
    expect(openConfigGroupModal).toHaveBeenCalledWith();
  });

  it('creates categories with the default visibility in personal space', () => {
    renderHook(() => useAgentActionsDropdownMenu({ openConfigGroupModal: vi.fn() }));

    expect(createSessionGroupMenuItemMock).toHaveBeenCalledWith(undefined);
  });
});
