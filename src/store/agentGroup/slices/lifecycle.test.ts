import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatGroupService } from '@/services/chatGroup';

import { useAgentGroupStore } from '../store';

// Mock dependencies
vi.mock('@/services/chatGroup', () => ({
  chatGroupService: {
    addAgentsToGroup: vi.fn(),
    createGroup: vi.fn(),
    getGroups: vi.fn(),
  },
}));

vi.mock('@/store/session', () => ({
  getSessionStoreState: vi.fn(() => ({
    activeId: 'some-session-id',
    refreshSessions: vi.fn().mockResolvedValue(undefined),
    sessions: [],
    switchSession: vi.fn(),
  })),
}));

describe('ChatGroupLifecycleSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state
    act(() => {
      useAgentGroupStore.setState({
        groupMap: {},
        groups: [],
        groupsInit: false,
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createGroup', () => {
    it('should create a new group and switch to it', async () => {
      const mockGroup = {
        id: 'new-group-id',
        title: 'Test Group',
        userId: 'user-1',
      };

      vi.mocked(chatGroupService.createGroup).mockResolvedValue({
        group: mockGroup as any,
        supervisorAgentId: 'supervisor-1',
      });
      vi.mocked(chatGroupService.getGroups).mockResolvedValue([mockGroup as any]);

      const { result } = renderHook(() => useAgentGroupStore());

      let groupId: string = '';
      await act(async () => {
        groupId = await result.current.createGroup({ title: 'Test Group' });
      });

      expect(groupId).toBe('new-group-id');
      expect(chatGroupService.createGroup).toHaveBeenCalledWith({ title: 'Test Group' });
    });

    it('should add agents to group if provided', async () => {
      const mockGroup = {
        id: 'new-group-id',
        title: 'Test Group',
        userId: 'user-1',
      };

      vi.mocked(chatGroupService.createGroup).mockResolvedValue({
        group: mockGroup as any,
        supervisorAgentId: 'supervisor-1',
      });
      vi.mocked(chatGroupService.addAgentsToGroup).mockResolvedValue({ added: [], existing: [] });
      vi.mocked(chatGroupService.getGroups).mockResolvedValue([mockGroup as any]);

      const { result } = renderHook(() => useAgentGroupStore());

      await act(async () => {
        await result.current.createGroup({ title: 'Test Group' }, ['agent-1', 'agent-2']);
      });

      expect(chatGroupService.addAgentsToGroup).toHaveBeenCalledWith('new-group-id', [
        'agent-1',
        'agent-2',
      ]);
    });

    it('should not switch session when silent is true', async () => {
      const mockSwitchSession = vi.fn();
      const { getSessionStoreState } = await import('@/store/session');
      vi.mocked(getSessionStoreState).mockReturnValue({
        activeId: 'some-session-id',
        refreshSessions: vi.fn().mockResolvedValue(undefined),
        sessions: [],
        switchSession: mockSwitchSession,
      } as any);

      const mockGroup = {
        id: 'new-group-id',
        title: 'Test Group',
        userId: 'user-1',
      };

      vi.mocked(chatGroupService.createGroup).mockResolvedValue({
        group: mockGroup as any,
        supervisorAgentId: 'supervisor-1',
      });
      vi.mocked(chatGroupService.getGroups).mockResolvedValue([mockGroup as any]);

      const { result } = renderHook(() => useAgentGroupStore());

      await act(async () => {
        await result.current.createGroup({ title: 'Test Group' }, [], true);
      });

      expect(mockSwitchSession).not.toHaveBeenCalled();
    });
  });
});
