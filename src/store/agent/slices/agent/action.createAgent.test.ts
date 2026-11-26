import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as activeWorkspaceModule from '@/business/client/hooks/useActiveWorkspaceId';
import { createReplicaState } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr';
import * as cacheScopeModule from '@/libs/swr/useCacheScope';
import { agentService } from '@/services/agent';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';

import { useAgentStore } from '../../store';

vi.mock('@/services/agent', () => ({
  AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT: 12,
  agentService: {
    createAgent: vi.fn(),
    getAgentConfigById: vi.fn(),
    getBuiltinAgent: vi.fn(),
    getSessionConfig: vi.fn(),
    queryAgents: vi.fn(),
    updateAgentConfig: vi.fn(),
    updateAgentMeta: vi.fn(),
  },
}));

vi.mock('@/services/agentDocument', () => ({
  resolveAgentDocumentsContext: vi.fn(),
}));

vi.mock('../../utils/sidebarAgentNames', () => ({
  getSidebarAgentNames: vi.fn().mockResolvedValue([]),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
}));

vi.mock('swr', async (importOriginal) => {
  const modules = await importOriginal();
  return {
    ...(modules as any),
    mutate: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(cacheScopeModule, 'useCacheScope').mockImplementation(() =>
    cacheScopeModule.getCacheScope(),
  );
  setScopedMutate(vi.fn() as any);
  useAgentStore.setState({
    activeAgentId: undefined,
    agentConfigErrorMap: {},
    agentConfigReplica: createReplicaState(),
    agentMap: {},
    agentNotFoundMap: {},
    builtinAgentIdMap: {},
    builtinAgentMap: {},
    builtinAgentReplica: createReplicaState(),
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
              name: null,
              title: 'Stale Agent',
            },
          ],
        });
      });

      await act(async () => {
        await result.current.createAgent({ config: { title: 'New Agent' } });
      });

      expect(result.current.availableAgentsStale).toBe(true);
    });

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
