/**
 * @vitest-environment happy-dom
 *
 * The agent-label registry is a `@lobechat/replica` resource whose view is the
 * home store's flat `agentLabels` field: the persisted projection paints while
 * the network confirms it, an unchanged response keeps the array reference, and
 * a cache-scope switch drops the previous workspace's registry before paint —
 * applying a foreign label id to an agent would be a destructive write.
 */
import { randomUUID } from 'node:crypto';

import type { AgentLabelListItem } from '@lobechat/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { agentLabelService } from '@/services/agentLabel';
import { useHomeStore } from '@/store/home';
import { agentLabelSelectors } from '@/store/home/selectors';

import { initialLabelState } from './initialState';
import { agentLabelsResource } from './projection';

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

const label = (id: string, overrides: Partial<AgentLabelListItem> = {}): AgentLabelListItem =>
  ({
    archived: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    id,
    name: id,
    usageCount: 0,
    ...overrides,
  }) as AgentLabelListItem;

/** Never-resolving fetch: what the store holds can only have come from storage. */
const pending = () => new Promise<never>(() => {});

const STORAGE_KEY = agentLabelsResource.storageKey({});

const renderSync = () =>
  renderHook(() => useHomeStore((s) => s.useFetchAgentLabels)(true), { wrapper });

describe('agent label registry replica', () => {
  const scopes = new Set<string>();
  let scope = '';

  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    useScope(`label-user-${randomUUID()}:personal`);
    useHomeStore.setState({ ...initialLabelState });
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].map((value) =>
        agentLabelsResource.storage!.remove({ queryKey: STORAGE_KEY, scope: value }),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted registry before the network answers', async () => {
    await agentLabelsResource.storage!.set(
      { queryKey: STORAGE_KEY, scope },
      { data: [label('l1', { name: 'Cached' })], updatedAt: 1 },
    );
    vi.spyOn(agentLabelService, 'getLabels').mockImplementation(pending);

    renderSync();

    await waitFor(() => expect(useHomeStore.getState().isAgentLabelsInit).toBe(true));
    expect(agentLabelSelectors.allLabels(useHomeStore.getState())[0].name).toBe('Cached');
  });

  it('keeps the registry reference when the server returns an unchanged list', async () => {
    const getLabels = vi.spyOn(agentLabelService, 'getLabels').mockResolvedValue([label('l1')]);
    renderSync();
    await waitFor(() => expect(useHomeStore.getState().agentLabels).toHaveLength(1));
    const before = useHomeStore.getState().agentLabels;

    getLabels.mockResolvedValue([label('l1')]);
    await act(() => useHomeStore.getState().refreshAgentLabels());

    expect(useHomeStore.getState().agentLabels).toBe(before);
  });

  it('drops the previous scope’s registry on a cache-scope switch', async () => {
    const getLabels = vi
      .spyOn(agentLabelService, 'getLabels')
      .mockResolvedValue([label('l1', { name: 'Personal' })]);
    const { rerender } = renderSync();
    await waitFor(() => expect(useHomeStore.getState().agentLabels).toHaveLength(1));

    // Switch identity: the new scope's registry is still in flight.
    useScope(`${scope.split(':')[0]}:ws-1`);
    getLabels.mockImplementation(pending);
    rerender();

    expect(useHomeStore.getState().agentLabels).toEqual([]);
    expect(agentLabelSelectors.isLabelsInit(useHomeStore.getState())).toBe(false);
  });

  it('refreshes the registry after a label is created', async () => {
    const getLabels = vi.spyOn(agentLabelService, 'getLabels').mockResolvedValue([]);
    vi.spyOn(agentLabelService, 'createLabel').mockResolvedValue('l1');
    renderSync();
    await waitFor(() => expect(useHomeStore.getState().isAgentLabelsInit).toBe(true));

    getLabels.mockResolvedValue([label('l1', { name: 'Fresh' })]);
    await act(() => useHomeStore.getState().createAgentLabel({ name: 'Fresh' }));

    await waitFor(() =>
      expect(agentLabelSelectors.allLabels(useHomeStore.getState())).toHaveLength(1),
    );
    expect(agentLabelSelectors.allLabels(useHomeStore.getState())[0].name).toBe('Fresh');
  });
});
