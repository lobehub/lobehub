import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sessionService } from '@/services/session';
import { useSessionStore } from '@/store/session';

afterEach(() => {
  vi.restoreAllMocks();
});

vi.mock('@/components/AntdStaticMethods', () => ({
  message: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    destroy: vi.fn(),
  },
}));

describe('createSessionGroupSlice', () => {
  describe('addSessionGroup', () => {
    it('should add a session group and refresh sessions', async () => {
      const mockId = 'mock-id';
      const mockName = 'Test Group';
      vi.spyOn(sessionService, 'createSessionGroup').mockResolvedValue(mockId);
      const spyOnRefreshSessions = vi.spyOn(useSessionStore.getState(), 'refreshSessions');

      const { result } = renderHook(() => useSessionStore());

      let returnedId;
      await act(async () => {
        returnedId = await result.current.addSessionGroup(mockName);
      });

      expect(sessionService.createSessionGroup).toHaveBeenCalledWith(mockName);
      expect(spyOnRefreshSessions).toHaveBeenCalled();
      expect(returnedId).toBe(mockId);
    });
  });

  describe('removeSessionGroup', () => {
    it('should remove a session group and refresh sessions', async () => {
      const mockId = 'mock-id';
      vi.spyOn(sessionService, 'removeSessionGroup').mockResolvedValueOnce(undefined as any);
      const spyOnRefreshSessions = vi.spyOn(useSessionStore.getState(), 'refreshSessions');

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.removeSessionGroup(mockId);
      });

      expect(sessionService.removeSessionGroup).toHaveBeenCalledWith(mockId);
      expect(spyOnRefreshSessions).toHaveBeenCalled();
    });
  });

  describe('updateSessionGroupId', () => {
    it('should update a session group id and refresh sessions', async () => {
      const mockSessionId = 'session-id';
      const mockGroupId = 'group-id';
      vi.spyOn(sessionService, 'updateSession').mockResolvedValueOnce(undefined as any);
      const spyOnRefreshSessions = vi.spyOn(useSessionStore.getState(), 'refreshSessions');

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.updateSessionGroupId(mockSessionId, mockGroupId);
      });

      expect(sessionService.updateSession).toHaveBeenCalledWith(mockSessionId, {
        group: mockGroupId,
      });
      expect(spyOnRefreshSessions).toHaveBeenCalled();
    });
  });

  describe('updateSessionGroupName', () => {
    it('should update a session group name and refresh sessions', async () => {
      const mockId = 'mock-id';
      const mockName = 'New Name';
      const spyOnRefreshSessions = vi.spyOn(useSessionStore.getState(), 'refreshSessions');
      vi.spyOn(sessionService, 'updateSessionGroup').mockResolvedValueOnce(undefined as any);

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.updateSessionGroupName(mockId, mockName);
      });

      expect(sessionService.updateSessionGroup).toHaveBeenCalledWith(mockId, { name: mockName });
      expect(spyOnRefreshSessions).toHaveBeenCalled();
    });
  });

  describe('updateSessionGroupSort', () => {
    it('should update session group sort order and refresh sessions', async () => {
      const mockItems: any[] = [
        { id: 'id1', sort: 0 },
        { id: 'id2', sort: 1 },
      ];
      vi.spyOn(sessionService, 'updateSessionGroupOrder').mockResolvedValueOnce(undefined as any);
      const spyOnRefreshSessions = vi.spyOn(useSessionStore.getState(), 'refreshSessions');

      const { result } = renderHook(() => useSessionStore());

      await act(async () => {
        await result.current.updateSessionGroupSort(mockItems);
      });

      expect(sessionService.updateSessionGroupOrder).toHaveBeenCalledWith(
        mockItems.map((item) => ({ id: item.id, sort: item.sort })),
      );
      expect(spyOnRefreshSessions).toHaveBeenCalled();
    });
  });
});
