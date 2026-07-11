import { CHAT_GROUP_SESSION_ID_PREFIX } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { message } from '@/components/AntdStaticMethods';
import { setScopedMutate } from '@/libs/swr';
import { agentConfigKeys } from '@/libs/swr/keys';
import { agentService } from '@/services/agent';
import { agentDocumentService } from '@/services/agentDocument';
import { type LobeAgentConfig } from '@/types/agent';
import { withSWR } from '~test-utils';

import { useAgentStore } from '../../store';

// Mock zustand/traditional for store testing
vi.mock('zustand/traditional');

// Mock agentService
vi.mock('@/services/agent', () => ({
  AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT: 12,
  agentService: {
    createAgent: vi.fn(),
    getAgentConfigById: vi.fn(),
    getSessionConfig: vi.fn(),
    queryAgents: vi.fn(),
    updateAgentConfig: vi.fn(),
    updateAgentMeta: vi.fn(),
  },
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: {
    listDocuments: vi.fn(),
  },
  agentDocumentSWRKeys: {
    documents: (agentId: string) => ['agent:documents', agentId] as const,
    documentsList: (agentId: string) => ['agent:documentsList', agentId] as const,
  },
  resolveAgentDocumentsContext: vi.fn(),
}));

vi.mock('@/components/AntdStaticMethods', () => ({
  message: {
    error: vi.fn(),
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
  setScopedMutate(vi.fn() as any);
  useAgentStore.setState({
    activeAgentId: undefined,
    agentMap: {},
    builtinAgentIdMap: {},
    availableAgents: undefined,
    updateAgentConfigSignal: undefined,
    agentDocumentsMap: {},
    streamingSystemRole: undefined,
    streamingSystemRoleAgentId: undefined,
    streamingSystemRoleGeneration: 0,
    streamingSystemRoleInProgress: false,
    updateAgentMetaSignal: undefined,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AgentSlice Actions', () => {
  describe('system role streaming', () => {
    it('accepts chunks and lets only the stream owner clear the visual buffer', async () => {
      const { result } = renderHook(() => useAgentStore());
      const persistPrompt = vi
        .spyOn(result.current, 'optimisticUpdateAgentConfig')
        .mockResolvedValue(undefined);

      let generation = 0;
      act(() => {
        generation = result.current.startStreamingSystemRole('agent-a');
        result.current.appendStreamingSystemRole('agent-b', generation, 'wrong');
        result.current.appendStreamingSystemRole('agent-a', generation, 'owned');
      });

      expect(result.current).toMatchObject({
        streamingSystemRole: 'owned',
        streamingSystemRoleAgentId: 'agent-a',
        streamingSystemRoleGeneration: generation,
        streamingSystemRoleInProgress: true,
      });

      await act(async () => {
        await result.current.finishStreamingSystemRole('agent-b', generation);
      });

      expect(persistPrompt).not.toHaveBeenCalled();
      expect(result.current.streamingSystemRoleAgentId).toBe('agent-a');

      await act(async () => {
        await result.current.finishStreamingSystemRole('agent-a', generation);
      });

      expect(persistPrompt).not.toHaveBeenCalled();
      expect(result.current).toMatchObject({
        streamingSystemRole: undefined,
        streamingSystemRoleAgentId: undefined,
        streamingSystemRoleInProgress: false,
      });
    });

    it('does not let a stale finish clear a newer stream for the same agent', async () => {
      const { result } = renderHook(() => useAgentStore());

      let oldGeneration = 0;
      act(() => {
        oldGeneration = result.current.startStreamingSystemRole('agent-a');
        result.current.appendStreamingSystemRole('agent-a', oldGeneration, 'old stream');
      });

      let newGeneration = 0;
      act(() => {
        newGeneration = result.current.startStreamingSystemRole('agent-a');
        result.current.appendStreamingSystemRole('agent-a', oldGeneration, 'stale chunk');
        result.current.appendStreamingSystemRole('agent-a', newGeneration, 'new stream');
      });

      await act(async () => {
        await result.current.finishStreamingSystemRole('agent-a', oldGeneration);
      });

      expect(result.current).toMatchObject({
        streamingSystemRole: 'new stream',
        streamingSystemRoleAgentId: 'agent-a',
        streamingSystemRoleGeneration: newGeneration,
        streamingSystemRoleInProgress: true,
      });

      await act(async () => {
        await result.current.finishStreamingSystemRole('agent-a', newGeneration);
      });

      expect(result.current).toMatchObject({
        streamingSystemRole: undefined,
        streamingSystemRoleAgentId: undefined,
        streamingSystemRoleInProgress: false,
      });
    });
  });

  describe('createAgent', () => {
    it('should invalidate cached available agents after creating an agent', async () => {
      vi.mocked(agentService.createAgent).mockResolvedValue({ agentId: 'agent-2' });
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        useAgentStore.setState({
          availableAgents: [
            {
              avatar: null,
              backgroundColor: null,
              description: 'stale',
              id: 'agent-1',
              title: 'Stale Agent',
            },
          ],
        });
      });

      await act(async () => {
        await result.current.createAgent({ config: { title: 'New Agent' } });
      });

      expect(result.current.availableAgents).toBeUndefined();
    });
  });

  describe('useFetchAgentDocuments', () => {
    it('should fetch agent documents via listDocuments', async () => {
      const docs = [
        {
          documentId: 'doc-1',
          filename: 'setup.md',
          id: 'doc-1',
          title: 'Setup',
        },
      ];
      vi.mocked(agentDocumentService.listDocuments).mockResolvedValue(docs as any);

      const store = renderHook(() => useAgentStore(), { wrapper: withSWR });

      const { result } = renderHook(() => store.result.current.useFetchAgentDocuments('agent-1'), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(docs);
      });
      expect(agentDocumentService.listDocuments).toHaveBeenCalledWith({ agentId: 'agent-1' });
    });
  });

  describe('useFetchAvailableAgents', () => {
    it('should sync fetched available agents into store cache', async () => {
      vi.mocked(agentService.queryAgents).mockResolvedValue([
        {
          avatar: null,
          backgroundColor: null,
          description: 'Helps with setup',
          id: 'agent-1',
          title: 'Setup',
        },
      ]);

      const { result } = renderHook(() => useAgentStore(), { wrapper: withSWR });

      renderHook(() => result.current.useFetchAvailableAgents(true), { wrapper: withSWR });

      await waitFor(() => {
        expect(result.current.availableAgents).toEqual([
          {
            avatar: null,
            backgroundColor: null,
            description: 'Helps with setup',
            id: 'agent-1',
            title: 'Setup',
          },
        ]);
      });
      expect(agentService.queryAgents).toHaveBeenCalledWith({ limit: 12 });
    });
  });

  describe('useFetchAgentConfig', () => {
    it('adopts the fetched agent as active when none is active yet', async () => {
      vi.mocked(agentService.getAgentConfigById).mockResolvedValue({
        id: 'agent-1',
        title: 'Setup',
      } as any);

      const { result } = renderHook(() => useAgentStore(), { wrapper: withSWR });

      renderHook(() => result.current.useFetchAgentConfig(true, 'agent-1'), { wrapper: withSWR });

      await waitFor(() => {
        expect(result.current.agentMap['agent-1']).toMatchObject({ id: 'agent-1', title: 'Setup' });
      });
      expect(result.current.activeAgentId).toBe('agent-1');
    });

    it('does not hijack activeAgentId when another agent is already active', async () => {
      // The active agent is owned by the route-level sync; simulate the routed agent.
      useAgentStore.setState({ activeAgentId: 'routed-agent' });

      vi.mocked(agentService.getAgentConfigById).mockResolvedValue({
        id: 'inbox-agent',
        title: 'Lobe AI',
      } as any);

      const { result } = renderHook(() => useAgentStore(), { wrapper: withSWR });

      // A background / secondary config fetch for a different agent (e.g. the
      // inbox config requested by the home input or another open tab).
      renderHook(() => result.current.useFetchAgentConfig(true, 'inbox-agent'), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        expect(result.current.agentMap['inbox-agent']).toMatchObject({ id: 'inbox-agent' });
      });
      // The background fetch only populates agentMap; it must not steal the active agent.
      expect(result.current.activeAgentId).toBe('routed-agent');
    });
  });

  describe('invalidateAvailableAgents', () => {
    it('should clear cached available agents', () => {
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        useAgentStore.setState({
          availableAgents: [
            {
              avatar: null,
              backgroundColor: null,
              description: 'stale',
              id: 'agent-1',
              title: 'Stale Agent',
            },
          ],
        });
      });

      act(() => {
        result.current.invalidateAvailableAgents();
      });

      expect(result.current.availableAgents).toBeUndefined();
    });
  });

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

    it('should deep merge nested chatConfig fields into existing agent entry', () => {
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        result.current.internal_dispatchAgentMap('agent-1', {
          chatConfig: { enableHistoryCount: true, historyCount: 10 },
        });
      });

      act(() => {
        result.current.internal_dispatchAgentMap('agent-1', {
          chatConfig: { enableReasoning: true },
        });
      });

      expect(result.current.agentMap['agent-1']).toEqual({
        chatConfig: {
          enableHistoryCount: true,
          enableReasoning: true,
          historyCount: 10,
        },
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

    it('should drop a workingDirByDevice entry when patched with undefined', () => {
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        result.current.internal_dispatchAgentMap('agent-1', {
          agencyConfig: {
            executionTarget: 'local',
            workingDirByDevice: { 'device-a': '/a', 'device-b': '/b' },
          },
        });
      });

      act(() => {
        // merge() alone would re-add device-a; the prune step honors the delete
        result.current.internal_dispatchAgentMap('agent-1', {
          agencyConfig: { workingDirByDevice: { 'device-a': undefined } },
        } as any);
      });

      expect(result.current.agentMap['agent-1']?.agencyConfig).toEqual({
        executionTarget: 'local',
        workingDirByDevice: { 'device-b': '/b' },
      });
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

    it('does not abort an in-flight save when another agent is updated', async () => {
      const { result } = renderHook(() => useAgentStore());
      let resolveAgentA: ((value: any) => void) | undefined;

      vi.mocked(agentService.updateAgentConfig).mockImplementation((agentId) => {
        if (agentId === 'agent-a') {
          return new Promise((resolve) => {
            resolveAgentA = resolve;
          });
        }

        return Promise.resolve({ agent: { id: agentId } as any, success: true });
      });

      let saveAgentA!: Promise<void>;
      act(() => {
        saveAgentA = result.current.updateAgentConfigById('agent-a', { model: 'model-a' });
      });
      await waitFor(() => expect(agentService.updateAgentConfig).toHaveBeenCalledTimes(1));

      const agentASignal = vi.mocked(agentService.updateAgentConfig).mock.calls[0][2];

      await act(async () => {
        await result.current.updateAgentConfigById('agent-b', { model: 'model-b' });
      });

      expect(agentASignal?.aborted).toBe(false);

      await act(async () => {
        resolveAgentA?.({ agent: { id: 'agent-a' } as any, success: true });
        await saveAgentA;
      });
    });

    it('should surface the failure and roll back to server truth when the save is rejected', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockRejectedValue(
        new Error('Workspace agent can only bind devices enrolled in the same workspace.'),
      );
      vi.spyOn(console, 'error').mockImplementation(() => {});

      act(() => {
        useAgentStore.setState({ activeAgentId: 'agent-1' });
      });

      const refreshSpy = vi.spyOn(result.current, 'internal_refreshAgentConfig');

      await act(async () => {
        await result.current.updateAgentConfig({
          agencyConfig: { boundDeviceId: 'personal-device', executionTarget: 'device' },
        });
      });

      expect(message.error).toHaveBeenCalled();
      // Optimistic value must not survive a rejected write — refetch server truth.
      expect(refreshSpy).toHaveBeenCalledWith('agent-1');
      expect(result.current.saveStatus).toBe('idle');
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

    it('should preserve explicit null when clearing avatar', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentMeta).mockResolvedValue({
        agent: { avatar: null } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({ activeAgentId: 'agent-1' });
      });

      await act(async () => {
        await result.current.updateAgentMeta({ avatar: null });
      });

      expect(agentService.updateAgentMeta).toHaveBeenCalledWith(
        'agent-1',
        { avatar: null },
        expect.any(AbortSignal),
      );
    });

    it('keeps in-flight metadata saves isolated by agent', async () => {
      const { result } = renderHook(() => useAgentStore());
      let resolveAgentA: ((value: any) => void) | undefined;

      vi.mocked(agentService.updateAgentMeta).mockImplementation((agentId) => {
        if (agentId === 'agent-a') {
          return new Promise((resolve) => {
            resolveAgentA = resolve;
          });
        }

        return Promise.resolve({ agent: { id: agentId } as any, success: true });
      });

      let saveAgentA!: Promise<void>;
      act(() => {
        saveAgentA = result.current.updateAgentMetaById('agent-a', { title: 'Agent A' });
      });
      await waitFor(() => expect(agentService.updateAgentMeta).toHaveBeenCalledTimes(1));

      const agentASignal = vi.mocked(agentService.updateAgentMeta).mock.calls[0][2];

      await act(async () => {
        await result.current.updateAgentMetaById('agent-b', { title: 'Agent B' });
      });

      expect(agentASignal?.aborted).toBe(false);

      await act(async () => {
        resolveAgentA?.({ agent: { id: 'agent-a' } as any, success: true });
        await saveAgentA;
      });
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

    it('should send the latest local agencyConfig when persisting a nested patch', async () => {
      const { result } = renderHook(() => useAgentStore());
      const latestAgencyConfig = {
        boundDeviceId: 'current-device',
        executionTarget: 'local',
        heterogeneousProvider: {
          command: 'claude',
          env: { CLAUDE_CODE_CRED_KEY: 'cred-key' },
          type: 'claude-code',
        },
        workingDirByDevice: { 'current-device': '/repos/lobehub' },
      } as const;
      const nextAgencyConfig = {
        ...latestAgencyConfig,
        heterogeneousProvider: { ...latestAgencyConfig.heterogeneousProvider, effort: 'high' },
      };

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { agencyConfig: nextAgencyConfig } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          agentMap: { 'agent-1': { agencyConfig: latestAgencyConfig } as any },
        });
      });

      await act(async () => {
        await result.current.updateAgentConfigById('agent-1', {
          agencyConfig: { heterogeneousProvider: { effort: 'high' } },
        } as any);
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
        'agent-1',
        { agencyConfig: nextAgencyConfig },
        expect.any(AbortSignal),
      );
    });

    // Note: refreshSessions is no longer called after optimistic update
    // as the implementation now uses API returned data directly

    it('should refresh agent config SWR cache after a confirmed config update', async () => {
      const { result } = renderHook(() => useAgentStore());
      const scopedMutate = vi.fn().mockResolvedValue(undefined);
      setScopedMutate(scopedMutate as any);

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { id: 'agent-1', model: 'model-b', provider: 'lobehub' } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          agentMap: { 'agent-1': { id: 'agent-1', model: 'model-a', provider: 'lobehub' } },
        });
      });

      await act(async () => {
        await result.current.updateAgentConfigById('agent-1', {
          model: 'model-b',
          provider: 'lobehub',
        });
      });

      const configCacheCalls = scopedMutate.mock.calls.filter(
        ([key]) => JSON.stringify(key) === JSON.stringify(agentConfigKeys.config('agent-1')),
      );
      expect(configCacheCalls).toEqual([[agentConfigKeys.config('agent-1')]]);
    });

    it('should not refresh agent config SWR cache when save fails', async () => {
      const { result } = renderHook(() => useAgentStore());
      const scopedMutate = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      setScopedMutate(scopedMutate as any);

      vi.mocked(agentService.updateAgentConfig).mockRejectedValue(new Error('save failed'));

      act(() => {
        useAgentStore.setState({
          agentMap: { 'agent-1': { id: 'agent-1', model: 'model-a', provider: 'lobehub' } },
        });
      });

      await act(async () => {
        await result.current.updateAgentConfigById('agent-1', {
          model: 'model-b',
          provider: 'lobehub',
        });
      });

      const configCacheCalls = scopedMutate.mock.calls.filter(
        ([key]) => JSON.stringify(key) === JSON.stringify(agentConfigKeys.config('agent-1')),
      );
      expect(configCacheCalls).toHaveLength(0);
      expect(result.current.agentMap['agent-1']).toMatchObject({ model: 'model-b' });
    });
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
          availableAgents: [
            {
              avatar: null,
              backgroundColor: null,
              description: 'Old Desc',
              id: 'agent-1',
              title: 'Old Title',
            },
          ],
        });
      });

      await act(async () => {
        await result.current.optimisticUpdateAgentMeta('agent-1', { title: 'New Title' });
      });

      expect(result.current.agentMap['agent-1']).toEqual({
        description: 'New Desc',
        title: 'New Title',
      });
      expect(result.current.availableAgents).toBeUndefined();
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

    it('should not fetch when agentId is a chat-group session id', async () => {
      const { result } = renderHook(
        () =>
          useAgentStore().useFetchAgentConfig(true, `${CHAT_GROUP_SESSION_ID_PREFIX}group-chat`),
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

    it('should record fetch error in agentConfigErrorMap and clear it on retry', async () => {
      const error = Object.assign(new Error('boom'), { meta: { shouldRetry: false } });
      vi.mocked(agentService.getAgentConfigById).mockRejectedValueOnce(error);

      renderHook(() => useAgentStore().useFetchAgentConfig(true, 'agent-err'), {
        wrapper: withSWR,
      });

      await waitFor(() =>
        expect(useAgentStore.getState().agentConfigErrorMap['agent-err']).toBe('boom'),
      );

      await act(async () => {
        await useAgentStore.getState().retryAgentConfigFetch('agent-err');
      });

      expect(useAgentStore.getState().agentConfigErrorMap['agent-err']).toBeUndefined();
    });

    it('should clear a stale fetch error once data arrives', async () => {
      useAgentStore.setState({ agentConfigErrorMap: { 'agent-1': 'boom' } });

      const mockAgentConfig = { id: 'agent-1', model: 'gpt-4' } as LobeAgentConfig;
      vi.mocked(agentService.getAgentConfigById).mockResolvedValueOnce(mockAgentConfig as any);

      const { result } = renderHook(() => useAgentStore().useFetchAgentConfig(true, 'agent-1'), {
        wrapper: withSWR,
      });

      await waitFor(() => expect(result.current.data).toEqual(mockAgentConfig));

      expect(useAgentStore.getState().agentConfigErrorMap['agent-1']).toBeUndefined();
    });
  });

  describe('useHydrateAgentConfig', () => {
    it('should hydrate agent config without changing activeAgentId', async () => {
      const mockAgentConfig = {
        id: 'agent-1',
        model: 'gpt-4',
        systemRole: 'You are a helpful assistant',
      } as LobeAgentConfig;

      useAgentStore.setState({ activeAgentId: 'agent-current' });
      vi.mocked(agentService.getAgentConfigById).mockResolvedValueOnce(mockAgentConfig as any);

      const { result } = renderHook(() => useAgentStore().useHydrateAgentConfig(true, 'agent-1'), {
        wrapper: withSWR,
      });

      await waitFor(() => expect(result.current.data).toEqual(mockAgentConfig));

      expect(agentService.getAgentConfigById).toHaveBeenCalledWith('agent-1');
      expect(useAgentStore.getState().activeAgentId).toBe('agent-current');
      expect(useAgentStore.getState().agentMap['agent-1']).toBeDefined();
    });
  });
});
