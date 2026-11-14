/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useGroupDropdownMenu } from './useDropdownMenu';

const createConnectAgentMenuItemMock = vi.hoisted(() => vi.fn(() => ({ key: 'newPlatformAgent' })));

vi.mock('@lobehub/ui', () => ({
  Icon: () => null,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {},
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: { refreshAgentList: () => void }) => unknown) =>
    selector({ refreshAgentList: vi.fn() }),
}));

vi.mock('../../../../hooks', () => ({
  useCreateMenuItems: () => ({
    createAgentMenuItem: () => ({ key: 'newAgent' }),
    createConnectAgentMenuItem: createConnectAgentMenuItemMock,
    createGroupChatMenuItem: () => ({ key: 'newGroupChat' }),
  }),
  useSessionGroupMenuItems: () => ({
    configGroupMenuItem: () => ({ key: 'config' }),
    deleteGroupMenuItem: () => ({ key: 'delete' }),
    renameGroupMenuItem: () => ({ key: 'rename' }),
  }),
}));

vi.mock('../../useSidebarGroupVisibility', () => ({
  useSidebarGroupVisibility: () => ({ setSidebarGroupVisible: vi.fn() }),
}));

const getMenuLayout = (items: ReturnType<typeof useGroupDropdownMenu>) =>
  (items ?? []).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    if ('type' in item && item.type === 'divider') return ['divider'];
    if ('key' in item && item.key) return [item.key];
    return [];
  });

describe('Category useGroupDropdownMenu', () => {
  it('includes Connect External Agents with the current category context', () => {
    const { result } = renderHook(() =>
      useGroupDropdownMenu({
        anchor: null,
        id: 'group-1',
        isCustomGroup: true,
        name: 'Coding',
        openConfigGroupModal: vi.fn(),
        visibility: 'private',
      }),
    );

    expect(getMenuLayout(result.current)).toEqual([
      'newAgent',
      'newGroupChat',
      'divider',
      'newPlatformAgent',
      'divider',
      'rename',
      'config',
      'hideFromSidebar',
      'divider',
      'delete',
    ]);
    expect(createConnectAgentMenuItemMock).toHaveBeenCalledWith({
      groupId: 'group-1',
      visibility: 'private',
    });
  });

  it('puts a public workspace folder’s pin entries first and drops the hide entry', () => {
    const { result } = renderHook(() =>
      useGroupDropdownMenu({
        anchor: null,
        id: 'group-1',
        isCustomGroup: true,
        name: 'Coding',
        openConfigGroupModal: vi.fn(),
        pinMenuItems: [{ key: 'pin' }, { key: 'pinForTeam' }] as any,
        visibility: 'public',
      }),
    );

    expect(getMenuLayout(result.current)).toEqual([
      'newAgent',
      'newGroupChat',
      'divider',
      'newPlatformAgent',
      'divider',
      'pin',
      'pinForTeam',
      'divider',
      'rename',
      'config',
      'divider',
      'delete',
    ]);
  });

  it('drops the hide entry even when a member has no pin entry to offer', () => {
    const { result } = renderHook(() =>
      useGroupDropdownMenu({
        anchor: null,
        id: 'group-1',
        isCustomGroup: true,
        name: 'Coding',
        openConfigGroupModal: vi.fn(),
        pinMenuItems: [],
        visibility: 'public',
      }),
    );

    expect(getMenuLayout(result.current)).not.toContain('hideFromSidebar');
  });
});
