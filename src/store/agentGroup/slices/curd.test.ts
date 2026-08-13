import { type AgentGroupDetail } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@/const/settings';
import type * as SwrModule from '@/libs/swr';
import { mutate } from '@/libs/swr';
import {
  chatGroupProjectionSelectors,
  getChatGroupProjection,
  getProjectionStoreState,
  useProjectionStore,
} from '@/projection';
import { chatGroupService } from '@/services/chatGroup';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { withSWR } from '~test-utils';

import { useAgentGroupStore } from '../store';

// Mock dependencies
vi.mock('@/services/chatGroup', () => ({
  chatGroupService: {
    getGroupDetail: vi.fn(),
    getGroupDetailWithAccess: vi.fn(),
    updateGroup: vi.fn(),
  },
}));

vi.mock('@/libs/swr', async (importOriginal) => {
  const actual = await importOriginal<typeof SwrModule>();
  return {
    ...actual,
    mutate: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => 'user-1:personal',
  isAnonymousScope: () => false,
  isScopeTrusted: () => false,
  useCacheScope: () => 'user-1:personal',
}));

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

describe('ChatGroupCurdSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectionStore.setState({ scopes: {} });
    getProjectionStoreState().commitChatGroupDetail(
      'user-1:personal',
      createMockGroup({ id: 'group-1', title: 'Test Group' }),
      { group: 'full', members: {} },
      'network',
    );
    // Reset store state
    act(() => {
      useAgentGroupStore.setState({
        activeGroupId: 'group-1',
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
    it('syncs the active supervisor from canonical Projection data after the request settles', async () => {
      const group = createMockGroup({ supervisorAgentId: 'supervisor-1' });
      vi.mocked(chatGroupService.getGroupDetailWithAccess).mockResolvedValue({
        access: 'full',
        data: group,
        memberAccess: {},
      } as any);
      useAgentStore.setState({ activeAgentId: undefined });
      useChatStore.setState({ activeAgentId: undefined });

      const { result } = renderHook(
        () => {
          const store = useAgentGroupStore();
          const request = store.useFetchGroupDetail(true, 'group-1');
          return { request, store };
        },
        { wrapper: withSWR },
      );

      await waitFor(() =>
        expect(result.current.request.data?.observedAt).toEqual(expect.any(Number)),
      );
      await waitFor(() => {
        expect(useAgentStore.getState().activeAgentId).toBe('supervisor-1');
        expect(useChatStore.getState().activeAgentId).toBe('supervisor-1');
      });
    });

    it('should remove stale local group data and mark not-found when detail revalidation reports not found', async () => {
      vi.mocked(chatGroupService.getGroupDetailWithAccess).mockResolvedValue(null);

      const { result } = renderHook(
        () => {
          const store = useAgentGroupStore();
          const request = store.useFetchGroupDetail(true, 'group-1');
          return { request, store };
        },
        { wrapper: withSWR },
      );

      await waitFor(() =>
        expect(result.current.request.data?.observedAt).toEqual(expect.any(Number)),
      );
      await waitFor(() =>
        expect(
          getChatGroupProjection(chatGroupProjectionSelectors.getGroupById('group-1')),
        ).toBeUndefined(),
      );
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
      getProjectionStoreState().commitChatGroupDetail(
        'user-1:personal',
        createMockGroup({ id: 'group-1', title: 'Group One' }),
        { group: 'full', members: {} },
        'network',
      );
      getProjectionStoreState().commitChatGroupDetail(
        'user-1:personal',
        createMockGroup({ id: 'group-2', title: 'Group Two' }),
        { group: 'full', members: {} },
        'network',
      );
      act(() => {
        useAgentGroupStore.setState({ activeGroupId: 'group-1' });
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
      expect(
        getChatGroupProjection(chatGroupProjectionSelectors.getGroupById('group-1'))?.title,
      ).toBe('Group One Draft');
      expect(
        getChatGroupProjection(chatGroupProjectionSelectors.getGroupById('group-2'))?.title,
      ).toBe('Group Two');
    });
  });
});
