/**
 * @vitest-environment happy-dom
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppIndexedDBStorage, cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { initialAgentSliceState } from '@/store/agent/slices/agent/initialState';
import { useUserStore } from '@/store/user';

import { useAgentProfileDetail } from './useAgentProfileDetail';

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

/** The rows the agent config replica reads (`replica:<name>:v<version>`). */
const configStorage = new AppIndexedDBStorage<unknown>({
  namespace: 'replica:agentConfig:v1',
});

describe('useAgentProfileDetail', () => {
  let scope = '';

  beforeEach(() => {
    scope = `profile-card-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => {
      useAgentStore.setState(initialAgentSliceState);
      useUserStore.setState({ isSignedIn: true } as any);
    });
  });

  afterEach(async () => {
    cleanup();
    await configStorage.remove({ queryKey: 'agt_writer', scope });
    vi.restoreAllMocks();
  });

  it('paints the card from the agent config replica before the network answers', async () => {
    await configStorage.set(
      { queryKey: 'agt_writer', scope },
      { data: { id: 'agt_writer', plugins: ['a', 'b'], title: 'Writer' }, updatedAt: 1 },
    );
    vi.spyOn(agentService, 'getAgentConfigById').mockImplementation(
      () => new Promise(() => {}) as any,
    );

    const { result } = renderHook(() => useAgentProfileDetail('agt_writer', true), { wrapper });

    await waitFor(() =>
      expect(result.current.detail).toMatchObject({ plugins: ['a', 'b'], title: 'Writer' }),
    );
    expect(result.current.isLoading).toBe(false);
  });

  it('shares the config the rest of the app already confirmed instead of fetching again', async () => {
    const lookup = vi
      .spyOn(agentService, 'getAgentConfigById')
      .mockResolvedValue({ id: 'agt_writer', title: 'Writer' } as any);

    renderHook(
      () => {
        // The conversation's own config sync and an open profile card at once.
        useAgentStore.getState().useHydrateAgentConfig(true, 'agt_writer');
        return useAgentProfileDetail('agt_writer', true);
      },
      { wrapper },
    );

    await waitFor(() =>
      expect(useAgentStore.getState().agentMap['agt_writer']).toMatchObject({ title: 'Writer' }),
    );
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('reads and syncs nothing while the card is closed', () => {
    const lookup = vi.spyOn(agentService, 'getAgentConfigById');

    const { result } = renderHook(() => useAgentProfileDetail('agt_writer', false), { wrapper });

    expect(result.current.detail).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });
});
