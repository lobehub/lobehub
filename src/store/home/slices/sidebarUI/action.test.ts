import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { INBOX_SESSION_ID } from '@/const/session';
import { agentService } from '@/services/agent';
import { chatGroupService } from '@/services/chatGroup';
import { homeService } from '@/services/home';
import { sessionService } from '@/services/session';
import { getAgentStoreState } from '@/store/agent';
import { useHomeStore } from '@/store/home';
import { getSessionStoreState } from '@/store/session';

// Mock dependencies
vi.mock('@/components/AntdStaticMethods', () => ({
  message: {
    destroy: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@/store/session', () => ({
  getSessionStoreState: vi.fn(() => ({
    activeId: 'test-session',
    switchSession: vi.fn(),
  })),
}));

vi.mock('@/store/agent', () => ({
  getAgentStoreState: vi.fn(() => ({
    setActiveAgentId: vi.fn(),
  })),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createSidebarUISlice', () => {
  // ========== Agent Operations ==========
  describe('pinAgent', () => {
    it('should pin an agent and refresh agent list', async () => {
      const mockAgentId = 'agent-123';
      vi.spyOn(agentService, 'updateAgentPinned').mockResolvedValueOnce(undefined as any);
      const spyOnRefresh = vi.spyOn(useHomeStore.getState(), 'refreshAgentList');

      const { result } = renderHook(() => useHomeStore());

      await act(async () => {
        await result.current.pinAgent(mockAgentId, true);
      });

      expect(agentService.updateAgentPinned).toHaveBeenCalledWith(mockAgentId, true);
      expect(spyOnRefresh).toHaveBeenCalled();
    });

    it('should unpin an agent and refresh agent list', async () => {
      const mockAgentId = 'agent-123';
      vi.spyOn(agentService, 'updateAgentPinned').mockResolvedValueOnce(undefined as any);
      const spyOnRefresh = vi.spyOn(useHomeStore.getState(), 'refreshAgentList');

      const { result } = renderHook(() => useHomeStore());

      await act(async () => {
        await result.current.pinAgent(mockAgentId, false);
      });

      expect(agentService.updateAgentPinned).toHaveBeenCalledWith(mockAgentId, false);
      expect(spyOnRefresh).toHaveBeenCalled();
    });
  });

  describe('pinAgentGroup', () => {
    it('should pin an agent group and refresh agent list', async () => {
      const mockGroupId = 'group-123';
      vi.spyOn(chatGroupService, 'updateGroup').mockResolvedValueOnce(undefined as any);
      const spyOnRefresh = vi.spyOn(useHomeStore.getState(), 'refreshAgentList');

      const { result } = renderHook(() => useHomeStore());

      await act(async () => {
        await result.current.pinAgentGroup(mockGroupId, true);
      });

      expect(chatGroupService.updateGroup).toHaveBeenCalledWith(mockGroupId, { pinned: true });
      expect(spyOnRefresh).toHaveBeenCalled();
    });

    it('should unpin an agent group and refresh agent list', async () => {
      const mockGroupId = 'group-123';
      vi.spyOn(chatGroupService, 'updateGroup').mockResolvedValueOnce(undefined as any);
      const spyOnRefresh = vi.spyOn(useHomeStore.getState(), 'refreshAgentList');

      const { result } = renderHook(() => useHomeStore());

      await act(async () => {
        await result.current.pinAgentGroup(mockGroupId, false);
      });

      expect(chatGroupService.updateGroup).toHaveBeenCalledWith(mockGroupId, { pinned: false });
      expect(spyOnRefresh).toHaveBeenCalled();
    });
  });

  describe('removeAgent', () => {
    it('should remove an agent and refresh agent list', async () => {
      const mockAgentId = 'agent-123';
      vi.spyOn(agentService, 'removeAgent').mockResolvedValueOnce(undefined as any);
      const spyOnRefresh = vi.spyOn(useHomeStore.getState(), 'refreshAgentList');

      const { result } = renderHook(() => useHomeStore());

      await act(async () => {
        await result.current.removeAgent(mockAgentId);
      });

      expect(agentService.removeAgent).toHaveBeenCalledWith(mockAgentId);
      expect(spyOnRefresh).toHaveBeenCalled();
    });

    it('should switch to inbox when removing the active session', async () => {
      const mockAgentId = 'active-agent';
      const mockSwitchSession = vi.fn();

      vi.mocked(getSessionStoreState).mockReturnValue({
        activeId: mockAgentId,
        switchSession: mockSwitchSession,
      } as any);

      vi.spyOn(agentService, 'removeAgent').mockResolvedValueOnce(undefined as any);
      vi.spyOn(useHomeStore.getState(), 'refreshAgentList');

      const { result } = renderHook(() => useHomeStore());

      await act(async () => {
        await result.current.removeAgent(mockAgentId);
      });

      // removeAgent only removes and refreshes the agent list; session switching is handled in SessionStore.removeSession
      expect(mockSwitchSession).not.toHaveBeenCalledWith(INBOX_SESSION_ID);
    });
  });

  describe('duplicateAgent', () => {
    it('should duplicate an agent and switch to the new agent', async () => {
      const mockAgentId = 'agent-123';
      const mockNewAgentId = 'new-agent-456';
      const mockSetActiveAgentId = vi.fn();

      vi.mocked(getAgentStoreState).mockReturnValue({
        setActiveAgentId: mockSetActiveAgentId,
      } as any);

      vi.spyOn(agentService, 'duplicateAgent').mockResolvedValueOnce({ agentId: mockNewAgentId });
      const spyOnRefresh = vi.spyOn(useHomeStore.getState(), 'refreshAgentList');

      const { result } = renderHook(() => useHomeStore());

      await act(async () => {
        await result.current.duplicateAgent(mockAgentId, 'Copied Agent');
      });

      expect(agentService.duplicateAgent).toHaveBeenCalledWith(mockAgentId, 'Copied Agent');
      expect(spyOnRefresh).toHaveBeenCalled();
      expect(mockSetActiveAgentId).toHaveBeenCalledWith(mockNewAgentId);
    });

    it('should show error message when duplication fails', async () => {
      const mockAgentId = 'agent-123';
      const { message } = await import('@/components/AntdStaticMethods');

      vi.spyOn(agentService, 'duplicateAgent').mockResolvedValueOnce(null);
      vi.spyOn(useHomeStore.getState(), 'refreshAgentList');

      const { result } = renderHook(() => useHomeStore());

      await act(async () => {
        await result.current.duplicateAgent(mockAgentId, 'Test');
      });

      expect(message.error).toHaveBeenCalled();
    });

    it('should use provided title when duplicating', async () => {
      const mockAgentId = 'agent-123';
      const mockNewAgentId = 'new-agent-456';

      vi.mocked(getAgentStoreState).mockReturnValue({
        setActiveAgentId: vi.fn(),
      } as any);

      vi.spyOn(agentService, 'duplicateAgent').mockResolvedValueOnce({ agentId: mockNewAgentId });
      vi.spyOn(useHomeStore.getState(), 'refreshAgentList');

      const { result } = renderHook(() => useHomeStore());

      await act(async () => {
        await result.current.duplicateAgent(mockAgentId, 'Custom Title');
      });

      expect(agentService.duplicateAgent).toHaveBeenCalledWith(mockAgentId, 'Custom Title');
    });
  });

  describe('updateAgentGroup', () => {
    it('should update agent group and refresh agent list', async () => {
      const mockAgentId = 'agent-123';
      const mockGroupId = 'group-456';
      vi.spyOn(homeService, 'updateAgentSessionGroupId').mockResolvedValueOnce(undefined as any);
      const spyOnRefresh = vi.spyOn(useHomeStore.getState(), 'refreshAgentList');

      const { result } = renderHook(() => useHomeStore());

      await act(async () => {
        await result.current.updateAgentGroup(mockAgentId, mockGroupId);
      });

      expect(homeService.updateAgentSessionGroupId).toHaveBeenCalledWith(mockAgentId, mockGroupId);
      expect(spyOnRefresh).toHaveBeenCalled();
    });

    it('should set group to default when groupId is null', async () => {
      const mockAgentId = 'agent-123';
      vi.spyOn(homeService, 'updateAgentSessionGroupId').mockResolvedValueOnce(undefined as any);
      vi.spyOn(useHomeStore.getState(), 'refreshAgentList');

      const { result } = renderHook(() => useHomeStore());

      await act(async () => {
        await result.current.updateAgentGroup(mockAgentId, null);
      });

      expect(homeService.updateAgentSessionGroupId).toHaveBeenCalledWith(mockAgentId, null);
    });
  });

  // ========== Group Operations ==========
  describe('addGroup', () => {
    it('should add a group and refresh agent list', async () => {
      const mockName = 'New Group';
      const mockId = 'group-789';
      vi.spyOn(sessionService, 'createSessionGroup').mockResolvedValueOnce(mockId);
      const spyOnRefresh = vi.spyOn(useHomeStore.getState(), 'refreshAgentList');

      const { result } = renderHook(() => useHomeStore());

      let returnedId: string;
      await act(async () => {
        returnedId = await result.current.addGroup(mockName);
      });

      expect(sessionService.createSessionGroup).toHaveBeenCalledWith(mockName);
      expect(spyOnRefresh).toHaveBeenCalled();
      expect(returnedId!).toBe(mockId);
    });
  });

  describe('removeGroup', () => {
    it('should remove a group and refresh agent list', async () => {
      const mockGroupId = 'group-123';
      vi.spyOn(sessionService, 'removeSessionGroup').mockResolvedValueOnce(undefined as any);
      const spyOnRefresh = vi.spyOn(useHomeStore.getState(), 'refreshAgentList');

      const { result } = renderHook(() => useHomeStore());

      await act(async () => {
        await result.current.removeGroup(mockGroupId);
      });

      expect(sessionService.removeSessionGroup).toHaveBeenCalledWith(mockGroupId);
      expect(spyOnRefresh).toHaveBeenCalled();
    });
  });

  describe('updateGroupName', () => {
    it('should update group name and refresh agent list', async () => {
      const mockGroupId = 'group-123';
      const mockName = 'Updated Name';
      vi.spyOn(sessionService, 'updateSessionGroup').mockResolvedValueOnce(undefined as any);
      const spyOnRefresh = vi.spyOn(useHomeStore.getState(), 'refreshAgentList');

      const { result } = renderHook(() => useHomeStore());

      await act(async () => {
        await result.current.updateGroupName(mockGroupId, mockName);
      });

      expect(sessionService.updateSessionGroup).toHaveBeenCalledWith(mockGroupId, {
        name: mockName,
      });
      expect(spyOnRefresh).toHaveBeenCalled();
    });
  });

  describe('updateGroupSort', () => {
    it('should update group sort order and refresh agent list', async () => {
      const mockItems: any[] = [
        { id: 'group-1', name: 'Group 1' },
        { id: 'group-2', name: 'Group 2' },
      ];
      vi.spyOn(sessionService, 'updateSessionGroupOrder').mockResolvedValueOnce(undefined as any);
      const spyOnRefresh = vi.spyOn(useHomeStore.getState(), 'refreshAgentList');

      const { result } = renderHook(() => useHomeStore());

      await act(async () => {
        await result.current.updateGroupSort(mockItems);
      });

      expect(sessionService.updateSessionGroupOrder).toHaveBeenCalledWith([
        { id: 'group-1', sort: 0 },
        { id: 'group-2', sort: 1 },
      ]);
      expect(spyOnRefresh).toHaveBeenCalled();
    });
  });

  // ========== UI State Actions ==========
  describe('setAgentRenamingId', () => {
    it('should set agent renaming id', () => {
      const { result } = renderHook(() => useHomeStore());

      act(() => {
        result.current.setAgentRenamingId('agent-123');
      });

      expect(result.current.agentRenamingId).toBe('agent-123');
    });

    it('should clear agent renaming id when set to null', () => {
      const { result } = renderHook(() => useHomeStore());

      act(() => {
        result.current.setAgentRenamingId('agent-123');
      });

      act(() => {
        result.current.setAgentRenamingId(null);
      });

      expect(result.current.agentRenamingId).toBeNull();
    });
  });

  describe('setAgentUpdatingId', () => {
    it('should set agent updating id', () => {
      const { result } = renderHook(() => useHomeStore());

      act(() => {
        result.current.setAgentUpdatingId('agent-456');
      });

      expect(result.current.agentUpdatingId).toBe('agent-456');
    });

    it('should clear agent updating id when set to null', () => {
      const { result } = renderHook(() => useHomeStore());

      act(() => {
        result.current.setAgentUpdatingId('agent-456');
      });

      act(() => {
        result.current.setAgentUpdatingId(null);
      });

      expect(result.current.agentUpdatingId).toBeNull();
    });
  });

  describe('setGroupRenamingId', () => {
    it('should set group renaming id', () => {
      const { result } = renderHook(() => useHomeStore());

      act(() => {
        result.current.setGroupRenamingId('group-123');
      });

      expect(result.current.groupRenamingId).toBe('group-123');
    });

    it('should clear group renaming id when set to null', () => {
      const { result } = renderHook(() => useHomeStore());

      act(() => {
        result.current.setGroupRenamingId('group-123');
      });

      act(() => {
        result.current.setGroupRenamingId(null);
      });

      expect(result.current.groupRenamingId).toBeNull();
    });
  });

  describe('setGroupUpdatingId', () => {
    it('should set group updating id', () => {
      const { result } = renderHook(() => useHomeStore());

      act(() => {
        result.current.setGroupUpdatingId('group-456');
      });

      expect(result.current.groupUpdatingId).toBe('group-456');
    });

    it('should clear group updating id when set to null', () => {
      const { result } = renderHook(() => useHomeStore());

      act(() => {
        result.current.setGroupUpdatingId('group-456');
      });

      act(() => {
        result.current.setGroupUpdatingId(null);
      });

      expect(result.current.groupUpdatingId).toBeNull();
    });
  });
});
