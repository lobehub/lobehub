/**
 * @vitest-environment happy-dom
 *
 * The agent-document skill registry is a per-agent replica: it paints from the
 * persisted copy on the first frame, the network only confirms, and each agent
 * keeps its own entry so switching never leaks the previous agent's bundles.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { agentDocumentService } from '@/services/agentDocument';

import { useToolStore } from '../../store';
import { initialAgentDocumentSkillsState } from './initialState';
import { type AgentDocumentSkillItem, agentDocumentSkillsResource } from './projection';
import { agentDocumentSkillsSelectors } from './selectors';

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: { listDocuments: vi.fn() },
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

const doc = (overrides: Record<string, unknown> = {}) =>
  ({
    description: null,
    documentId: 'doc-1',
    filename: 'demo',
    isSkillBundle: true,
    title: 'Demo',
    ...overrides,
  }) as any;

const skill = (
  name: string,
  overrides: Partial<AgentDocumentSkillItem> = {},
): AgentDocumentSkillItem => ({
  documentId: `doc-${name}`,
  identifier: `agent-skills:${name}`,
  name,
  ...overrides,
});

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const AGENT_1 = 'agent-1';
const AGENT_2 = 'agent-2';
const rowKey = (agentId: string) => agentDocumentSkillsResource.storageKey(agentId);

describe('agentDocumentSkills replica', () => {
  const scopes = new Set<string>();
  let scope = '';
  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  const listDocuments = () => vi.mocked(agentDocumentService.listDocuments);
  const skillsFor = (agentId: string) => useToolStore.getState().agentDocumentSkillsMap[agentId];
  const fetchSkills = (agentId: string | undefined) =>
    renderHook(() => useToolStore((s) => s.useFetchAgentDocumentSkills)(agentId), { wrapper });
  const readSkills = (agentId: string | undefined) =>
    renderHook(() => useToolStore(agentDocumentSkillsSelectors.getAgentDocumentSkills(agentId)));
  /**
   * Both agents in ONE tree: each `renderHook` mounts its own `SWRConfig`, so
   * only the last one's cache would receive the globally-scoped `mutate`.
   */
  const fetchBothAgents = () =>
    renderHook(
      () => ({
        one: useToolStore((s) => s.useFetchAgentDocumentSkills)(AGENT_1),
        two: useToolStore((s) => s.useFetchAgentDocumentSkills)(AGENT_2),
      }),
      { wrapper },
    );

  beforeEach(() => {
    useScope(`agent-doc-user-${randomUUID()}:personal`);
    act(() => useToolStore.setState(initialAgentDocumentSkillsState));
    listDocuments().mockReset();
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((value) =>
        [AGENT_1, AGENT_2].map((agentId) =>
          agentDocumentSkillsResource.storage!.remove({ queryKey: rowKey(agentId), scope: value }),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted bundles before the network answers', async () => {
    await agentDocumentSkillsResource.storage!.set(
      { queryKey: rowKey(AGENT_1), scope },
      { data: [skill('cached', { title: 'Cached' })], updatedAt: 1 },
    );
    listDocuments().mockImplementation(pending);

    const sync = fetchSkills(AGENT_1);
    const items = readSkills(AGENT_1);

    await waitFor(() => expect(items.result.current.map((s) => s.name)).toEqual(['cached']));
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('replaces the persisted copy with the server response and persists it', async () => {
    listDocuments().mockResolvedValue([
      doc({ documentId: 'd1', filename: 'server-skill', title: 'Server skill' }),
    ]);

    fetchSkills(AGENT_1);

    await waitFor(() => expect(skillsFor(AGENT_1)?.map((s) => s.name)).toEqual(['server-skill']));
    await waitFor(async () =>
      expect(
        (await agentDocumentSkillsResource.storage!.get({ queryKey: rowKey(AGENT_1), scope }))
          ?.data,
      ).toEqual([skill('server-skill', { documentId: 'd1', title: 'Server skill' })]),
    );
  });

  it('asks the server for the non-web skill bundles of the selected agent', async () => {
    listDocuments().mockResolvedValue([]);

    fetchSkills(AGENT_1);

    await waitFor(() => expect(listDocuments()).toHaveBeenCalled());
    expect(listDocuments()).toHaveBeenCalledWith({ agentId: AGENT_1, excludeWeb: true });
  });

  it('keeps each agent in its own entry and never leaks across agents', async () => {
    listDocuments().mockImplementation((async ({ agentId }: any) => [
      doc({ documentId: `d-${agentId}`, filename: agentId }),
    ]) as any);

    fetchBothAgents();

    await waitFor(() => expect(skillsFor(AGENT_1)?.map((s) => s.name)).toEqual([AGENT_1]));
    await waitFor(() => expect(skillsFor(AGENT_2)?.map((s) => s.name)).toEqual([AGENT_2]));

    // Neither agent's fetch overwrites the other's entry…
    expect(skillsFor(AGENT_1)?.map((s) => s.name)).toEqual([AGENT_1]);
    expect(skillsFor(AGENT_2)?.map((s) => s.name)).toEqual([AGENT_2]);
    // …and each selector reads only its own agent's bundles.
    expect(readSkills(AGENT_1).result.current.map((s) => s.name)).toEqual([AGENT_1]);
    expect(readSkills(AGENT_2).result.current.map((s) => s.name)).toEqual([AGENT_2]);
  });

  it('claims no entry and hits no network while no agent is selected', () => {
    const sync = fetchSkills(undefined);
    const items = readSkills(undefined);

    expect(sync.result.current.isValidating).toBe(false);
    expect(items.result.current).toEqual([]);
    expect(listDocuments()).not.toHaveBeenCalled();
  });

  it('refreshAgentDocumentSkills re-syncs one agent only', async () => {
    listDocuments().mockResolvedValue([doc({ filename: 'first' })]);
    fetchBothAgents();
    await waitFor(() => expect(skillsFor(AGENT_1)?.map((s) => s.name)).toEqual(['first']));
    await waitFor(() => expect(skillsFor(AGENT_2)?.map((s) => s.name)).toEqual(['first']));

    listDocuments().mockResolvedValue([doc({ filename: 'refreshed' })]);
    await act(() => useToolStore.getState().refreshAgentDocumentSkills(AGENT_1));

    await waitFor(() => expect(skillsFor(AGENT_1)?.map((s) => s.name)).toEqual(['refreshed']));
    // The refreshed agent must not drag the other agent's entry along: had the
    // refresh matched agent-2's sync too, it would now hold 'refreshed' as well.
    expect(skillsFor(AGENT_2)?.map((s) => s.name)).toEqual(['first']);
  });

  it('clearAgentDocumentSkills drops one agent’s cached entry', async () => {
    listDocuments().mockResolvedValue([doc({ filename: 'one' })]);
    fetchSkills(AGENT_1);
    await waitFor(() => expect(skillsFor(AGENT_1)).toBeDefined());

    act(() => useToolStore.getState().clearAgentDocumentSkills(AGENT_1));

    expect(skillsFor(AGENT_1)).toBeUndefined();
  });
});
