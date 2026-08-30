import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as activeWorkspaceModule from '@/business/client/hooks/useActiveWorkspaceId';
import { getAgentProjectionById, getProjectionStoreState, useProjectionStore } from '@/projection';
import { agentService } from '@/services/agent';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';

import { useAgentStore } from '../../store';

const SCOPE = 'user-1:personal';

vi.mock('zustand/traditional');

vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => SCOPE,
  isAnonymousScope: () => false,
  isScopeTrusted: () => false,
  useCacheScope: () => SCOPE,
}));

vi.mock('@/libs/swr', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  mutate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/agent', () => ({
  AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT: 12,
  agentService: {
    createAgent: vi.fn(),
    getAgentConfigByIdWithAccess: vi.fn(),
    queryAgents: vi.fn(),
    updateAgentConfig: vi.fn(),
    updateAgentMeta: vi.fn(),
  },
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: { listDocuments: vi.fn() },
  agentDocumentSWRKeys: {
    documents: (agentId: string) => ['agent:documents', agentId],
    documentsList: (agentId: string) => ['agent:documentsList', agentId],
  },
  resolveAgentDocumentsContext: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
}));

describe('Agent actions backed by Projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectionStore.setState({ scopes: {} });
    useAgentStore.setState({
      activeAgentId: undefined,
      agentConfigErrorMap: {},
      agentDocumentsMap: {},
      builtinAgentIdMap: {},
      updateAgentConfigSignal: undefined,
      updateAgentMetaSignal: undefined,
    });
  });

  it('deep-merges partial config writes in the canonical Projection', () => {
    act(() => {
      useAgentStore.getState().internal_dispatchAgentProjection('agent-1', {
        chatConfig: { enableHistoryCount: true, historyCount: 10 },
        model: 'model-a',
      });
      useAgentStore.getState().internal_dispatchAgentProjection('agent-1', {
        chatConfig: { enableReasoning: true },
        model: 'model-b',
      });
    });

    expect(getAgentProjectionById('agent-1')).toMatchObject({
      chatConfig: { enableHistoryCount: true, enableReasoning: true, historyCount: 10 },
      id: 'agent-1',
      model: 'model-b',
    });
  });

  it('honors per-device delete markers during an optimistic merge', () => {
    act(() => {
      useAgentStore.getState().internal_dispatchAgentProjection('agent-1', {
        agencyConfig: {
          executionTarget: 'local',
          workingDirByDevice: { 'device-a': '/a', 'device-b': '/b' },
        },
      });
      useAgentStore.getState().internal_dispatchAgentProjection('agent-1', {
        agencyConfig: { workingDirByDevice: { 'device-a': undefined } },
      } as any);
    });

    expect(getAgentProjectionById('agent-1')?.agencyConfig).toEqual({
      executionTarget: 'local',
      workingDirByDevice: { 'device-b': '/b' },
    });
  });

  it('publishes the optimistic value immediately and then applies the server result', async () => {
    getProjectionStoreState().commitAgentConfig(
      SCOPE,
      { id: 'agent-1', model: 'model-a' },
      'full',
      'network',
      100,
    );
    vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
      agent: { id: 'agent-1', model: 'model-server' },
      success: true,
    } as any);

    const pending = useAgentStore
      .getState()
      .optimisticUpdateAgentConfig('agent-1', { model: 'model-b' });
    expect(getAgentProjectionById('agent-1')?.model).toBe('model-b');

    await pending;

    expect(agentService.updateAgentConfig).toHaveBeenCalledWith(
      'agent-1',
      { model: 'model-b' },
      undefined,
    );
    expect(getAgentProjectionById('agent-1')?.model).toBe('model-server');
    expect(useAgentStore.getState().saveStatus).toBe('saved');
  });

  describe('createAgent', () => {
    it('should seed a personal name matching the user language', async () => {
      vi.mocked(agentService.createAgent).mockResolvedValue({ agentId: 'agent-2' });
      const status = useGlobalStore.getState().status;
      useGlobalStore.setState({ status: { ...status, language: 'zh-CN' } });
      const { result } = renderHook(() => useAgentStore());

      try {
        await act(async () => {
          await result.current.createAgent({ config: { title: '健康助手' } });
        });

        const config = vi.mocked(agentService.createAgent).mock.calls[0][0].config!;
        expect(config.title).toBe('健康助手');
        expect(config.name).toMatch(/^\p{Script=Han}+$/u);
      } finally {
        useGlobalStore.setState({ status });
      }
    });

    it('uses the product title as a personal heterogeneous agent name', async () => {
      vi.mocked(agentService.createAgent).mockResolvedValue({ agentId: 'agent-2' });
      const userState = useUserStore.getState();
      useUserStore.setState({
        isSignedIn: true,
        user: { fullName: 'Max', id: 'user-1' } as any,
      });
      const { result } = renderHook(() => useAgentStore());

      try {
        await act(async () => {
          await result.current.createAgent({
            config: {
              agencyConfig: { heterogeneousProvider: { command: 'claude', type: 'claude-code' } },
              title: 'Claude Code',
            },
          });
        });

        expect(vi.mocked(agentService.createAgent).mock.calls[0][0].config?.name).toBe(
          'Claude Code',
        );
      } finally {
        useUserStore.setState({ isSignedIn: userState.isSignedIn, user: userState.user });
      }
    });

    it('uses a stable English owner-qualified name for a shared workspace agent', async () => {
      vi.mocked(agentService.createAgent).mockResolvedValue({ agentId: 'agent-2' });
      vi.spyOn(activeWorkspaceModule, 'getActiveWorkspaceId').mockReturnValue('workspace-1');
      const userState = useUserStore.getState();
      const status = useGlobalStore.getState().status;
      useUserStore.setState({
        isSignedIn: true,
        user: { fullName: 'Max', id: 'user-1' } as any,
      });
      useGlobalStore.setState({ status: { ...status, language: 'zh-CN' } });
      const { result } = renderHook(() => useAgentStore());

      try {
        await act(async () => {
          await result.current.createAgent({
            config: {
              agencyConfig: { heterogeneousProvider: { command: 'claude', type: 'claude-code' } },
              title: 'Claude Code',
            },
          });
        });

        expect(vi.mocked(agentService.createAgent).mock.calls[0][0].config?.name).toBe(
          'Max’s Claude Code',
        );
      } finally {
        useUserStore.setState({ isSignedIn: userState.isSignedIn, user: userState.user });
        useGlobalStore.setState({ status });
      }
    });

    it('uses the product title as a workspace-private heterogeneous agent name', async () => {
      vi.mocked(agentService.createAgent).mockResolvedValue({ agentId: 'agent-2' });
      vi.spyOn(activeWorkspaceModule, 'getActiveWorkspaceId').mockReturnValue('workspace-1');
      const { result } = renderHook(() => useAgentStore());

      await act(async () => {
        await result.current.createAgent({
          config: {
            agencyConfig: { heterogeneousProvider: { command: 'claude', type: 'claude-code' } },
            title: 'Claude Code',
          },
          visibility: 'private',
        });
      });

      expect(vi.mocked(agentService.createAgent).mock.calls[0][0].config?.name).toBe('Claude Code');
    });

    it('uses the product title as a personal heterogeneous agent name for an anonymous owner', async () => {
      vi.mocked(agentService.createAgent).mockResolvedValue({ agentId: 'agent-2' });
      const userState = useUserStore.getState();
      useUserStore.setState({ isSignedIn: false, user: undefined });
      const { result } = renderHook(() => useAgentStore());

      try {
        await act(async () => {
          await result.current.createAgent({
            config: {
              agencyConfig: { heterogeneousProvider: { command: 'claude', type: 'claude-code' } },
              title: 'Claude Code',
            },
          });
        });

        expect(vi.mocked(agentService.createAgent).mock.calls[0][0].config?.name).toBe(
          'Claude Code',
        );
      } finally {
        useUserStore.setState({ isSignedIn: userState.isSignedIn, user: userState.user });
      }
    });

    it('should keep a name the caller already provided', async () => {
      vi.mocked(agentService.createAgent).mockResolvedValue({ agentId: 'agent-2' });
      const { result } = renderHook(() => useAgentStore());

      await act(async () => {
        await result.current.createAgent({ config: { name: 'Ada', title: 'Math Tutor' } });
      });

      expect(vi.mocked(agentService.createAgent).mock.calls[0][0].config?.name).toBe('Ada');
    });
  });
});
