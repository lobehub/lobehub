import { type AgentGroupDetail } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@/const/settings';
import type { ChatGroupItem } from '@/database/schemas/chatGroup';
import { replicaKeys } from '@/libs/replica';
import type * as SwrModule from '@/libs/swr';
import { mutate } from '@/libs/swr';
import { chatGroupService } from '@/services/chatGroup';

import { initialChatGroupState } from '../initialState';
import { agentGroupDetailResource } from '../projection';
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
  };
});

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
  deletedAt: null,
  isDeleted: null,
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

/**
 * `refreshGroupDetail` revalidates the replica sync query of one group. The
 * query key is derived from the resource (name + version + scope) and the entry
 * params, so assert the match predicate itself rather than a literal key tuple.
 */
const expectDetailRevalidated = (groupId: string) => {
  const match = vi.mocked(mutate).mock.calls.at(-1)?.[0] as ((key: unknown) => boolean) | undefined;
  expect(typeof match).toBe('function');

  const keyOf = (id: string) =>
    replicaKeys.sync(
      agentGroupDetailResource.name,
      agentGroupDetailResource.version,
      agentGroupDetailResource.scope.get(),
      id,
      { groupId: id },
    );

  expect(match!(keyOf(groupId))).toBe(true);
  expect(match!(keyOf(`${groupId}-other`))).toBe(false);
};

describe('ChatGroupCurdSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state
    act(() => {
      useAgentGroupStore.setState({
        ...initialChatGroupState,
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
      expect(result.current.groupMap['group-1'].title).toBe('Updated Title');
      expect(result.current.groups[0].title).toBe('Updated Title');
    });

    it('should refresh group detail after update', async () => {
      vi.mocked(chatGroupService.updateGroup).mockResolvedValue({} as any);

      const { result } = renderHook(() => useAgentGroupStore());

      await act(async () => {
        await result.current.updateGroup('group-1', { description: 'New description' });
      });

      expectDetailRevalidated('group-1');
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
      expect(result.current.groupMap['group-1'].config).toEqual(
        expect.objectContaining({ allowDM: false }),
      );
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

      expectDetailRevalidated('group-1');
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

      expectDetailRevalidated('group-1');
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
      expectDetailRevalidated('group-1');
      expect(result.current.groupMap['group-1']?.title).toBe('Group One Draft');
      expect(result.current.groupMap['group-2']?.title).toBe('Group Two');
    });
  });
});
