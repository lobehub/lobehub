/**
 * @vitest-environment happy-dom
 *
 * The agent-knowledge list is a `@lobechat/replica` resource whose view is the
 * agent store's `agentKnowledgeMap`: the persisted projection paints while the
 * network confirms it, an unchanged response keeps the array reference, a
 * refresh after a knowledge mutation repaints the surface, and a cache-scope
 * switch drops the previous identity's rows before paint.
 */
import { randomUUID } from 'node:crypto';

import { type KnowledgeItem } from '@lobechat/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { type PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { agentKnowledgeSelectors } from '@/store/agent/selectors';
import { KnowledgeType } from '@/types/knowledgeBase';

import { initialState } from '../../initialState';
import { type AgentKnowledgeListParams, agentKnowledgeListResource } from './projection';

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

const PARAMS: AgentKnowledgeListParams = { agentId: 'agent-1', visibility: 'private' };

const item = (id: string, overrides: Partial<KnowledgeItem> = {}): KnowledgeItem => ({
  enabled: true,
  id,
  name: id,
  type: KnowledgeType.File,
  ...overrides,
});

/** Never-resolving fetch: what the store holds can only have come from storage. */
const pending = () => new Promise<never>(() => {});

const STORAGE_KEY = agentKnowledgeListResource.storageKey(PARAMS);

/** The loaded rows of the surface under test, as the picker reads them. */
const rows = () => agentKnowledgeSelectors.getAgentKnowledgeList(PARAMS)(useAgentStore.getState());

const renderSync = () =>
  renderHook(
    () => useAgentStore((s) => s.useFetchFilesAndKnowledgeBases)(PARAMS.agentId, PARAMS.visibility),
    { wrapper },
  );

describe('agent knowledge list replica', () => {
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
    useScope(`knowledge-user-${randomUUID()}:personal`);
    useAgentStore.setState({ ...initialState });
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].map((value) =>
        agentKnowledgeListResource.storage!.remove({ queryKey: STORAGE_KEY, scope: value }),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted list before the network answers', async () => {
    await agentKnowledgeListResource.storage!.set(
      { queryKey: STORAGE_KEY, scope },
      { data: [item('f1', { name: 'Cached' })], updatedAt: 1 },
    );
    vi.spyOn(agentService, 'getFilesAndKnowledgeBases').mockImplementation(pending);

    renderSync();

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()![0].name).toBe('Cached');
  });

  it('keeps the list reference when the server returns an unchanged list', async () => {
    const get = vi.spyOn(agentService, 'getFilesAndKnowledgeBases').mockResolvedValue([item('f1')]);
    renderSync();
    await waitFor(() => expect(rows()).toHaveLength(1));
    const before = rows();

    get.mockResolvedValue([item('f1')]);
    await act(() => useAgentStore.getState().internal_refreshAgentKnowledge());

    expect(rows()).toBe(before);
  });

  it('repaints the surface after a knowledge mutation refreshes it', async () => {
    const get = vi.spyOn(agentService, 'getFilesAndKnowledgeBases').mockResolvedValue([item('f1')]);
    renderSync();
    await waitFor(() => expect(rows()).toHaveLength(1));

    get.mockResolvedValue([
      item('f1'),
      item('kb-1', { name: 'Fresh', type: KnowledgeType.KnowledgeBase }),
    ]);
    await act(() => useAgentStore.getState().internal_refreshAgentKnowledge());

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows()!.map((row) => row.id)).toEqual(['f1', 'kb-1']);
  });

  it('drops the previous scope’s rows on a cache-scope switch', async () => {
    const get = vi.spyOn(agentService, 'getFilesAndKnowledgeBases').mockResolvedValue([item('f1')]);
    const { rerender } = renderSync();
    await waitFor(() => expect(rows()).toHaveLength(1));

    // Switch identity: the new scope's rows are still in flight.
    useScope(`${scope.split(':')[0]}:ws-1`);
    get.mockImplementation(pending);
    rerender();

    expect(rows()).toBeUndefined();
  });
});
