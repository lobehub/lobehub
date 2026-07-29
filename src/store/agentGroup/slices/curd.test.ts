import { type AgentGroupDetail } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@/const/settings';
import type { ChatGroupItem } from '@/database/schemas/chatGroup';
import type * as SwrModule from '@/libs/swr';
import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { chatGroupService } from '@/services/chatGroup';

import { useAgentGroupStore } from '../store';

// Mock dependencies
vi.mock('@/services/chatGroup', () => ({
  chatGroupService: {
    getGroupDetail: vi.fn(),
    updateGroup: vi.fn(),
  },
}));

vi.mock('@/libs/swr', async (importOriginal) => {
  const actual = await importOriginal<typeof SwrModule>();
  return {
    ...actual,
    mutate: vi.fn().mockResolvedValue(undefined),
    useClientDataSWRWithSync: vi.fn(() => ({ data: undefined, isValidating: false })),
  };
});

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: vi.fn(() => null),
  useActiveWorkspaceId: vi.fn(() => null),
}));

// Helper to create mock AgentGroupDetail
const createMockGroup = (overrides: Partial<AgentGroupDetail>): AgentGroupDetail => ({
  agents: [],
  createdAt: new Date(),
  id: 'group-1',
  supervisorAgentId: 'supervisor-1',
  title: 'Test Group',
  updatedAt: new Date(),
  userId: 'user-1',
  ...overrides,
});

const createMockChatGroup = (overrides: Partial<ChatGroupItem> = {}): ChatGroupItem => ({
  accessedAt: new Date(),
  avatar: null,
  backgroundColor: null,
  clientId: null,
  config: null,
  content: null,
  createdAt: new Date(),
  description: null,
  editorData: null,
  groupId: null,
  id: 'group-1',
  marketIdentifier: null,
  pinned: false,
  title: 'Test Group',
  updatedAt: new Date(),
  userId: 'user-1',
  visibility: 'public',
  workspaceId: null,
  ...overrides,
});

describe('ChatGroupCurdSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state
    act(() => {
      useAgentGroupStore.setState({
        activeGroupId: 'group-1',
        groupMap: {
          'group-1': createMockGroup({ id: 'group-1', title: 'Test Group' }),
        },
        groups: [createMockChatGroup({ id: 'group-1', title: 'Test Group' })],
        groupsInit: true,
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('updateGroup', () => {
    it('should update group properties', async () => {
      vi.mocked(chatGroupService.updateGroup).mockResolvedValue({} as any);

      const { result } = renderHook(() => useAgentGroupStore());

      await act(async () => {
        await result.current.updateGroup('group-1', { title: 'Updated Title' });
      });

      expect(chatGroupService.updateGroup).toHaveBeenCalledWith('group-1', {
        title: 'Updated Title',
      });
    });

    it('should refresh group detail after update', async () => {
      vi.mocked(chatGroupService.updateGroup).mockResolvedValue({} as any);

      const { result } = renderHook(() => useAgentGroupStore());

      await act(async () => {
        await result.current.updateGroup('group-1', { description: 'New description' });
      });

      expect(mutate).toHaveBeenCalledWith(['group:detail', 'group-1']);
    });
  });

  describe('refreshGroups', () => {
    it('should invalidate the group list', async () => {
      const { result } = renderHook(() => useAgentGroupStore());

      await act(async () => {
        await result.current.refreshGroups();
      });

      expect(mutate).toHaveBeenCalledWith(['group:list', true]);
    });
  });

  describe('useFetchGroupDetail', () => {
    it('should remove stale local group data and mark not-found when detail revalidation reports not found', async () => {
      vi.mocked(chatGroupService.getGroupDetail).mockResolvedValue(null as any);

      const { result } = renderHook(() => useAgentGroupStore());

      act(() => {
        result.current.useFetchGroupDetail(true, 'group-1');
      });

      const swrCall = vi.mocked(useClientDataSWRWithSync).mock.calls.at(-1);
      const fetcher = swrCall?.[1] as (() => Promise<unknown>) | undefined;
      const swrOptions = swrCall?.[2];
      const onData = swrOptions?.onData as ((data: unknown) => void) | undefined;

      // "Gone / no access" resolves to null (settled 404 state) instead of throwing.
      await act(async () => {
        await expect(fetcher?.()).resolves.toBeNull();
      });
      act(() => {
        onData?.(null);
      });

      expect(result.current.groupMap['group-1']).toBeUndefined();
      expect(result.current.groups.some((group) => group.id === 'group-1')).toBe(false);
      expect(result.current.groupNotFoundMap['group-1']).toBe(true);
    });
  });

  describe('updateGroupConfig', () => {
    it('should update group config with merged defaults', async () => {
      vi.mocked(chatGroupService.updateGroup).mockResolvedValue({} as any);

      const { result } = renderHook(() => useAgentGroupStore());

      await act(async () => {
        await result.current.updateGroupConfig({ allowDM: false });
      });

      expect(chatGroupService.updateGroup).toHaveBeenCalledWith('group-1', {
        config: expect.objectContaining({
          ...DEFAULT_CHAT_GROUP_CHAT_CONFIG,
          allowDM: false,
        }),
      });
    });

    it('should not update if no current group', async () => {
      act(() => {
        useAgentGroupStore.setState({
          activeGroupId: undefined,
          groupMap: {},
        });
      });

      const { result } = renderHook(() => useAgentGroupStore());

      await act(async () => {
        await result.current.updateGroupConfig({ allowDM: false });
      });

      expect(chatGroupService.updateGroup).not.toHaveBeenCalled();
    });

    it('should refresh group detail after config update', async () => {
      vi.mocked(chatGroupService.updateGroup).mockResolvedValue({} as any);

      const { result } = renderHook(() => useAgentGroupStore());

      await act(async () => {
        await result.current.updateGroupConfig({ revealDM: true });
      });

      expect(mutate).toHaveBeenCalledWith(['group:detail', 'group-1']);
    });
  });

  describe('updateGroupMeta', () => {
    it('should update group meta', async () => {
      vi.mocked(chatGroupService.updateGroup).mockResolvedValue({} as any);

      const { result } = renderHook(() => useAgentGroupStore());

      await act(async () => {
        await result.current.updateGroupMeta({ title: 'New Title', description: 'New Desc' });
      });

      expect(chatGroupService.updateGroup).toHaveBeenCalledWith('group-1', {
        description: 'New Desc',
        title: 'New Title',
      });
    });

    it('should not update if no current group', async () => {
      act(() => {
        useAgentGroupStore.setState({
          activeGroupId: undefined,
          groupMap: {},
        });
      });

      const { result } = renderHook(() => useAgentGroupStore());

      await act(async () => {
        await result.current.updateGroupMeta({ title: 'New Title' });
      });

      expect(chatGroupService.updateGroup).not.toHaveBeenCalled();
    });

    it('should refresh group detail after meta update', async () => {
      vi.mocked(chatGroupService.updateGroup).mockResolvedValue({} as any);

      const { result } = renderHook(() => useAgentGroupStore());

      await act(async () => {
        await result.current.updateGroupMeta({ title: 'Updated' });
      });

      expect(mutate).toHaveBeenCalledWith(['group:detail', 'group-1']);
    });

    it('keeps an explicit metadata update bound to its original group', async () => {
      let resolveUpdate: (() => void) | undefined;
      vi.mocked(chatGroupService.updateGroup).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveUpdate = () => resolve({} as any);
          }),
      );
      act(() => {
        useAgentGroupStore.setState({
          activeGroupId: 'group-1',
          groupMap: {
            'group-1': createMockGroup({ id: 'group-1', title: 'Group One' }),
            'group-2': createMockGroup({ id: 'group-2', title: 'Group Two' }),
          },
        });
      });
      const { result } = renderHook(() => useAgentGroupStore());

      let updatePromise!: Promise<void>;
      act(() => {
        updatePromise = result.current.updateGroupMetaById('group-1', { title: 'Group One Draft' });
      });
      act(() => {
        useAgentGroupStore.setState({ activeGroupId: 'group-2' });
      });

      await act(async () => {
        resolveUpdate?.();
        await updatePromise;
      });

      expect(chatGroupService.updateGroup).toHaveBeenCalledExactlyOnceWith('group-1', {
        title: 'Group One Draft',
      });
      expect(mutate).toHaveBeenCalledWith(['group:detail', 'group-1']);
      expect(result.current.groupMap['group-1']?.title).toBe('Group One Draft');
      expect(result.current.groupMap['group-2']?.title).toBe('Group Two');
    });
  });
});
