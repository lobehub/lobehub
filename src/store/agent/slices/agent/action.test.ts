import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAgentProjectionById, getProjectionStoreState, useProjectionStore } from '@/projection';
import { agentService } from '@/services/agent';

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

vi.mock('@lobehub/ui/base-ui', () => ({ toast: { error: vi.fn() } }));

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
});
