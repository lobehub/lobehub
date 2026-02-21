import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { type LobeAgentConfig } from '@/types/agent';
import { withSWR } from '~test-utils';

import { useAgentStore } from '../../store';

// Mock zustand/traditional for store testing
vi.mock('zustand/traditional');

// Mock agentService
vi.mock('@/services/agent', () => ({
  agentService: {
    getAgentConfigById: vi.fn(),
    getSessionConfig: vi.fn(),
    updateAgentConfig: vi.fn(),
    updateAgentMeta: vi.fn(),
  },
}));

// Mock sessionStore
vi.mock('@/store/session', () => ({
  useSessionStore: {
    getState: vi.fn(() => ({
      refreshSessions: vi.fn(),
    })),
  },
}));

// Mock SWR mutate
vi.mock('swr', async (importOriginal) => {
  const modules = await importOriginal();
  return {
    ...(modules as any),
    mutate: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  useAgentStore.setState({
    activeAgentId: undefined,
    agentMap: {},
    builtinAgentIdMap: {},
    updateAgentConfigSignal: undefined,
    updateAgentMetaSignal: undefined,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AgentSlice Actions', () => {
  describe('internal_dispatchAgentMap', () => {
    it('should create new agent entry if not exists', () => {
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        result.current.internal_dispatchAgentMap('agent-1', { model: 'gpt-4' });
      });

      expect(result.current.agentMap['agent-1']).toEqual({ model: 'gpt-4' });
    });

    it('should merge config into existing agent entry', () => {
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        result.current.internal_dispatchAgentMap('agent-1', { model: 'gpt-4', systemRole: 'test' });
      });

      act(() => {
        result.current.internal_dispatchAgentMap('agent-1', { model: 'gpt-4o' });
      });

      expect(result.current.agentMap['agent-1']).toEqual({
        model: 'gpt-4o',
        systemRole: 'test',
      });
    });

    it('should not update state if result is equal', () => {
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        result.current.internal_dispatchAgentMap('agent-1', { model: 'gpt-4' });
      });

      const prevAgentMap = result.current.agentMap;

      act(() => {
        result.current.internal_dispatchAgentMap('agent-1', { model: 'gpt-4' });
      });

      // Should be the same reference if no change
      expect(result.current.agentMap).toBe(prevAgentMap);
    });
  });

  describe('internal_createAbortController', () => {
    it('should create a new abort controller', () => {
      const { result } = renderHook(() => useAgentStore());

      let controller: AbortController;
      act(() => {
        controller = result.current.internal_createAbortController('updateAgentConfigSignal');
      });

      expect(controller!).toBeInstanceOf(AbortController);
      expect(result.current.updateAgentConfigSignal).toBe(controller!);
    });

    it('should abort previous controller when creating new one', () => {
      const { result } = renderHook(() => useAgentStore());

      let controller1: AbortController;
      let controller2: AbortController;

      act(() => {
        controller1 = result.current.internal_createAbortController('updateAgentConfigSignal');
      });

      const abortSpy = vi.spyOn(controller1!, 'abort');

      act(() => {
        controller2 = result.current.internal_createAbortController('updateAgentConfigSignal');
      });

      expect(abortSpy).toHaveBeenCalled();
      expect(result.current.updateAgentConfigSignal).toBe(controller2!);
    });
  });

  describe('updateAgentConfig', () => {
    it('should not call optimisticUpdateAgentConfig if no activeAgentId', async () => {
      const { result } = renderHook(() => useAgentStore());

      const optimisticUpdateSpy = vi.spyOn(result.current, 'optimisticUpdateAgentConfig');

      await act(async () => {
        await result.current.updateAgentConfig({ model: 'gpt-4' });
      });

      expect(optimisticUpdateSpy).not.toHaveBeenCalled();
    });

    it('should call optimisticUpdateAgentConfig with activeAgentId', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { model: 'gpt-4' } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({ activeAgentId: 'agent-1' });
      });

      await act(async () => {
        await result.current.updateAgentConfig({ model: 'gpt-4' });
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        { model: 'gpt-4' },
        expect.any(AbortSignal),
      );
    });
  });

  describe('updateAgentMeta', () => {
    it('should not call optimisticUpdateAgentMeta if no activeAgentId', async () => {
      const { result } = renderHook(() => useAgentStore());

      const optimisticUpdateSpy = vi.spyOn(result.current, 'optimisticUpdateAgentMeta');

      await act(async () => {
        await result.current.updateAgentMeta({ title: 'New Title' });
      });

      expect(optimisticUpdateSpy).not.toHaveBeenCalled();
    });

    it('should call optimisticUpdateAgentMeta with activeAgentId', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentMeta).mockResolvedValue({
        agent: { title: 'New Title' } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({ activeAgentId: 'agent-1' });
      });

      await act(async () => {
        await result.current.updateAgentMeta({ title: 'New Title' });
      });

      expect(agentService.updateAgentMeta).toHaveBeenCalledWith(
        'agent-1',
        { title: 'New Title' },
        expect.any(AbortSignal),
      );
    });
  });

  describe('updateAgentChatConfig', () => {
    it('should not call updateAgentConfig if no activeAgentId', async () => {
      const { result } = renderHook(() => useAgentStore());

      const updateConfigSpy = vi.spyOn(result.current, 'updateAgentConfig');

      await act(async () => {
        await result.current.updateAgentChatConfig({ historyCount: 10 });
      });

      expect(updateConfigSpy).not.toHaveBeenCalled();
    });

    it('should call updateAgentConfig with chatConfig wrapper', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { chatConfig: { historyCount: 10 } } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({ activeAgentId: 'agent-1' });
      });

      await act(async () => {
        await result.current.updateAgentChatConfig({ historyCount: 10 });
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        { chatConfig: { historyCount: 10 } },
        expect.any(AbortSignal),
      );
    });
  });

  describe('optimisticUpdateAgentConfig', () => {
    it('should perform optimistic update and then use API result', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { model: 'gpt-4', provider: 'openai' } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { model: 'gpt-3.5-turbo' } },
        });
      });

      await act(async () => {
        await result.current.optimisticUpdateAgentConfig('agent-1', { model: 'gpt-4' });
      });

      // Should have the API returned data merged
      expect(result.current.agentMap['agent-1']).toEqual({
        model: 'gpt-4',
        provider: 'openai',
      });
    });

    // Note: refreshSessions is no longer called after optimistic update
    // as the implementation now uses API returned data directly
  });

  describe('optimisticUpdateAgentMeta', () => {
    it('should perform optimistic update and then use API result', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentMeta).mockResolvedValue({
        agent: { title: 'New Title', description: 'New Desc' } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { title: 'Old Title' } as any },
        });
      });

      await act(async () => {
        await result.current.optimisticUpdateAgentMeta('agent-1', { title: 'New Title' });
      });

      expect(result.current.agentMap['agent-1']).toEqual({
        description: 'New Desc',
        title: 'New Title',
      });
    });

    // Note: refreshSessions is no longer called after optimistic update
    // as the implementation now uses API returned data directly
  });

  describe('useFetchAgentConfig', () => {
    it('should not fetch when isLogin is false', async () => {
      const { result } = renderHook(() => useAgentStore().useFetchAgentConfig(false, 'agent-1'), {
        wrapper: withSWR,
      });

      expect(agentService.getAgentConfigById).not.toHaveBeenCalled();
      expect(result.current.data).toBeUndefined();
    });

    it('should not fetch when isLogin is undefined', async () => {
      const { result } = renderHook(
        () => useAgentStore().useFetchAgentConfig(undefined, 'agent-1'),
        { wrapper: withSWR },
      );

      expect(agentService.getAgentConfigById).not.toHaveBeenCalled();
      expect(result.current.data).toBeUndefined();
    });

    it('should not fetch when agentId starts with cg_', async () => {
      const { result } = renderHook(
        () => useAgentStore().useFetchAgentConfig(true, 'cg_group-chat'),
        { wrapper: withSWR },
      );

      expect(agentService.getAgentConfigById).not.toHaveBeenCalled();
      expect(result.current.data).toBeUndefined();
    });

    it('should fetch agent config when logged in with valid agentId', async () => {
      const mockAgentConfig = {
        id: 'agent-1',
        model: 'gpt-4',
        systemRole: 'You are a helpful assistant',
      } as LobeAgentConfig;

      vi.mocked(agentService.getAgentConfigById).mockResolvedValueOnce(mockAgentConfig as any);

      const { result } = renderHook(() => useAgentStore().useFetchAgentConfig(true, 'agent-1'), {
        wrapper: withSWR,
      });

      await waitFor(() => expect(result.current.data).toEqual(mockAgentConfig));

      expect(agentService.getAgentConfigById).toHaveBeenCalledWith('agent-1');
      expect(useAgentStore.getState().activeAgentId).toBe('agent-1');
      expect(useAgentStore.getState().agentMap['agent-1']).toBeDefined();
    });
  });
});
