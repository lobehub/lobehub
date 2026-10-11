import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    addAgentsToGroup: vi.fn(),
    removeAgentsFromGroup: vi.fn(),
    updateAgentInGroup: vi.fn(),
  },
}));

vi.mock('@/libs/swr', async (importOriginal) => {
  const actual = await importOriginal<typeof SwrModule>();
  return { ...actual, mutate: vi.fn().mockResolvedValue(undefined) };
});

/**
 * A member write refreshes the group's detail through the replica: assert the
 * sync query match predicate instead of the retired `group:detail` SWR tuple.
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

describe('ChatGroupMemberSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state
    act(() => {
      useAgentGroupStore.setState({ ...initialChatGroupState });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('addAgentsToGroup', () => {
    it('should add agents to a group', async () => {
      vi.mocked(chatGroupService.addAgentsToGroup).mockResolvedValue({ added: [], existing: [] });

      const { result } = renderHook(() => useAgentGroupStore());

      await act(async () => {
        await result.current.addAgentsToGroup('group-1', ['agent-1', 'agent-2']);
      });

      expect(chatGroupService.addAgentsToGroup).toHaveBeenCalledWith('group-1', [
        'agent-1',
        'agent-2',
      ]);
    });

    it('should refresh group detail after adding agents', async () => {
      vi.mocked(chatGroupService.addAgentsToGroup).mockResolvedValue({ added: [], existing: [] });

      const { result } = renderHook(() => useAgentGroupStore());

      await act(async () => {
        await result.current.addAgentsToGroup('group-1', ['agent-1']);
      });

      expectDetailRevalidated('group-1');
    });
  });

  describe('removeAgentFromGroup', () => {
    it('should remove an agent from a group', async () => {
      vi.mocked(chatGroupService.removeAgentsFromGroup).mockResolvedValue({
        deletedVirtualAgentIds: [],
        removedFromGroup: 1,
      });

      const { result } = renderHook(() => useAgentGroupStore());

      await act(async () => {
        await result.current.removeAgentFromGroup('group-1', 'agent-1');
      });

      expect(chatGroupService.removeAgentsFromGroup).toHaveBeenCalledWith('group-1', ['agent-1']);
    });

    it('should refresh group detail after removing agent', async () => {
      vi.mocked(chatGroupService.removeAgentsFromGroup).mockResolvedValue({
        deletedVirtualAgentIds: [],
        removedFromGroup: 1,
      });

      const { result } = renderHook(() => useAgentGroupStore());

      await act(async () => {
        await result.current.removeAgentFromGroup('group-1', 'agent-1');
      });

      expectDetailRevalidated('group-1');
    });
  });

  describe('reorderGroupMembers', () => {
    it('should reorder group members', async () => {
      vi.mocked(chatGroupService.updateAgentInGroup).mockResolvedValue({} as any);

      const { result } = renderHook(() => useAgentGroupStore());

      await act(async () => {
        await result.current.reorderGroupMembers('group-1', ['agent-2', 'agent-1', 'agent-3']);
      });

      expect(chatGroupService.updateAgentInGroup).toHaveBeenCalledTimes(3);
      expect(chatGroupService.updateAgentInGroup).toHaveBeenNthCalledWith(1, 'group-1', 'agent-2', {
        order: 0,
      });
      expect(chatGroupService.updateAgentInGroup).toHaveBeenNthCalledWith(2, 'group-1', 'agent-1', {
        order: 1,
      });
      expect(chatGroupService.updateAgentInGroup).toHaveBeenNthCalledWith(3, 'group-1', 'agent-3', {
        order: 2,
      });
    });

    it('should refresh group detail after reordering', async () => {
      vi.mocked(chatGroupService.updateAgentInGroup).mockResolvedValue({} as any);

      const { result } = renderHook(() => useAgentGroupStore());

      await act(async () => {
        await result.current.reorderGroupMembers('group-1', ['agent-1', 'agent-2']);
      });

      expectDetailRevalidated('group-1');
    });
  });
});
