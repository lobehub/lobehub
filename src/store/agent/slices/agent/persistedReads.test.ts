/**
 * @vitest-environment happy-dom
 *
 * A reload paints the agent store's remaining server reads from the local copy
 * while the network is still out: the available-agents list and the
 * server-default heterogeneous capability. Seeded through the storage rows the
 * replicas read (`replica:<name>:v<version>`), so the hooks under test are the
 * ones the app has always mounted.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppIndexedDBStorage, AppLocalStorage, cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { agentService } from '@/services/agent';
import { aiAgentService } from '@/services/aiAgent';

import { useAgentStore } from '../../store';
import { initialAgentSliceState } from './initialState';

vi.mock('@/services/agent', () => ({
  AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT: 12,
  agentService: { queryAgents: vi.fn() },
}));

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: { getServerDefaultHeterogeneousCapability: vi.fn() },
}));

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

/** The network never answers: whatever paints came from the device. */
const pending = () => new Promise<never>(() => {}) as Promise<any>;

const availableAgentsStorage = new AppIndexedDBStorage<unknown>({
  namespace: 'replica:availableAgents:v1',
});
const capabilityStorage = new AppLocalStorage<unknown>({
  namespace: 'replica:heteroServerDefaultCapability:v1',
});

const cachedAgents = [
  {
    avatar: null,
    backgroundColor: null,
    description: null,
    id: 'agt_cached',
    name: null,
    title: 'Cached agent',
  },
];

const cachedCapability = {
  agents: ['claude-code'],
  enabled: true,
  model: 'lobehub-default',
  models: { 'claude-code': ['claude-sonnet'] },
};

describe('agent store reads after a reload', () => {
  let scope = '';

  beforeEach(() => {
    scope = `agent-reload-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => useAgentStore.setState(initialAgentSliceState));
  });

  afterEach(async () => {
    cleanup();
    await availableAgentsStorage.remove({ queryKey: 'recent', scope });
    await capabilityStorage.remove({ queryKey: 'default', scope });
    vi.restoreAllMocks();
  });

  it('paints the available agents from the local copy before the network answers', async () => {
    await availableAgentsStorage.set(
      { queryKey: 'recent', scope },
      { data: cachedAgents, updatedAt: 1 },
    );
    vi.mocked(agentService.queryAgents).mockImplementation(pending);

    renderHook(() => useAgentStore.getState().useFetchAvailableAgents(true), { wrapper });

    await waitFor(() => expect(useAgentStore.getState().availableAgents).toEqual(cachedAgents));
  });

  it('paints the server-default capability from the local copy before the network answers', async () => {
    await capabilityStorage.set(
      { queryKey: 'default', scope },
      { data: cachedCapability, updatedAt: 1 },
    );
    vi.mocked(aiAgentService.getServerDefaultHeterogeneousCapability).mockImplementation(pending);

    renderHook(() => useAgentStore.getState().useFetchServerDefaultHeterogeneousCapability(true), {
      wrapper,
    });

    await waitFor(() =>
      expect((useAgentStore.getState() as any).heteroServerDefaultCapability).toEqual(
        cachedCapability,
      ),
    );
  });
});
