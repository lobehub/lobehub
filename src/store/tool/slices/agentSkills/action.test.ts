/**
 * @vitest-environment happy-dom
 *
 * The installed skills list and the loaded skill details are replicas: they
 * paint from the persisted copy on the first frame, the network only confirms,
 * a rename or delete reaches the list row and the loaded detail at once, and a
 * scope switch drops the previous identity's rows before the next paints.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { agentSkillService } from '@/services/skill';

import { useToolStore } from '../../store';
import { initialAgentSkillsState } from './initialState';
import {
  AGENT_SKILL_LIST_KEY,
  type AgentSkillDetail,
  agentSkillDetailResource,
  type AgentSkillListItem,
  agentSkillListResource,
} from './projection';

vi.mock('@/services/skill', () => ({
  agentSkillService: {
    createSkill: vi.fn(),
    deleteSkill: vi.fn(),
    getById: vi.fn(),
    importFromGitHub: vi.fn(),
    importFromUrl: vi.fn(),
    importFromZip: vi.fn(),
    list: vi.fn(),
    listResources: vi.fn(),
    updateSkill: vi.fn(),
  },
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

const skill = (id: string, name = id): AgentSkillListItem =>
  ({ id, identifier: id, name }) as AgentSkillListItem;

const detailOf = (item: AgentSkillListItem): AgentSkillDetail => ({
  resourceTree: [{ name: 'SKILL.md', path: 'SKILL.md', type: 'file' }],
  skillDetail: { ...item, content: '# body' } as any,
});

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const LIST_STORAGE_KEY = agentSkillListResource.storageKey({});

describe('agentSkills replicas', () => {
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
    useScope(`skill-user-${randomUUID()}:personal`);
    act(() => useToolStore.setState(initialAgentSkillsState));
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((value) => [
        agentSkillListResource.storage!.remove({ queryKey: LIST_STORAGE_KEY, scope: value }),
        agentSkillDetailResource.storage!.remove({ queryKey: 'db-1', scope: value }),
        agentSkillDetailResource.storage!.remove({ queryKey: 'missing', scope: value }),
      ]),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted list before the network answers', async () => {
    await agentSkillListResource.storage!.set(
      { queryKey: LIST_STORAGE_KEY, scope },
      { data: [skill('db-1', 'Cached')], updatedAt: 1 },
    );
    vi.mocked(agentSkillService.list).mockImplementation(pending);

    const sync = renderHook(() => useToolStore((s) => s.useFetchAgentSkills)(true), { wrapper });

    await waitFor(() =>
      expect(useToolStore.getState().agentSkillListMap[AGENT_SKILL_LIST_KEY]?.[0]?.name).toBe(
        'Cached',
      ),
    );
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('replaces the list with the server response and persists it', async () => {
    vi.mocked(agentSkillService.list).mockResolvedValue({
      data: [skill('db-1', 'Server')],
      total: 1,
    });

    renderHook(() => useToolStore((s) => s.useFetchAgentSkills)(true), { wrapper });

    await waitFor(() =>
      expect(useToolStore.getState().agentSkillListMap[AGENT_SKILL_LIST_KEY]?.[0]?.name).toBe(
        'Server',
      ),
    );
    await waitFor(async () =>
      expect(
        (await agentSkillListResource.storage!.get({ queryKey: LIST_STORAGE_KEY, scope }))?.data,
      ).toEqual([skill('db-1', 'Server')]),
    );
  });

  it('paints a skill detail page (skill + resource tree) from the persisted copy', async () => {
    await agentSkillDetailResource.storage!.set(
      { queryKey: 'db-1', scope },
      { data: detailOf(skill('db-1', 'Cached page')), updatedAt: 1 },
    );
    vi.mocked(agentSkillService.getById).mockImplementation(pending);
    vi.mocked(agentSkillService.listResources).mockImplementation(pending);

    const sync = renderHook(() => useToolStore((s) => s.useFetchAgentSkillDetail)('db-1'), {
      wrapper,
    });

    await waitFor(() =>
      expect(useToolStore.getState().agentSkillDetailMap['db-1']?.skillDetail?.name).toBe(
        'Cached page',
      ),
    );
    expect(sync.result.current.data?.resourceTree).toHaveLength(1);
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('keeps a not-found detail as an empty value instead of failing the surface', async () => {
    vi.mocked(agentSkillService.list).mockResolvedValue({ data: [], total: 0 });
    vi.mocked(agentSkillService.getById).mockResolvedValue(undefined);
    vi.mocked(agentSkillService.listResources).mockResolvedValue([]);

    renderHook(() => useToolStore((s) => s.useFetchAgentSkillDetail)('missing'), { wrapper });

    await waitFor(() =>
      expect(useToolStore.getState().agentSkillDetailMap['missing']).toBeDefined(),
    );
    expect(useToolStore.getState().agentSkillDetailMap['missing'].skillDetail).toBeUndefined();
    expect(useToolStore.getState().agentSkillDetailMap['missing'].resourceTree).toEqual([]);
  });

  it('drops the previous identity’s skills before the next one paints', async () => {
    vi.mocked(agentSkillService.list).mockResolvedValue({
      data: [skill('db-1', 'Mine')],
      total: 1,
    });
    const sync = renderHook(() => useToolStore((s) => s.useFetchAgentSkills)(true), { wrapper });
    await waitFor(() =>
      expect(useToolStore.getState().agentSkillListMap[AGENT_SKILL_LIST_KEY]).toHaveLength(1),
    );

    vi.mocked(agentSkillService.list).mockImplementation(pending);
    useScope(`skill-user-${randomUUID()}:personal`);
    sync.rerender();

    await waitFor(() =>
      expect(useToolStore.getState().agentSkillListMap[AGENT_SKILL_LIST_KEY]).toBeUndefined(),
    );
  });

  describe('mutations', () => {
    const seed = async () => {
      vi.mocked(agentSkillService.list).mockResolvedValue({
        data: [skill('db-1', 'Original'), skill('db-2')],
        total: 2,
      });
      vi.mocked(agentSkillService.getById).mockResolvedValue({
        content: 'body',
        id: 'db-1',
        identifier: 'db-1',
        name: 'Original',
      } as any);
      vi.mocked(agentSkillService.listResources).mockResolvedValue([
        { name: 'SKILL.md', path: 'SKILL.md', type: 'file' },
      ]);
      renderHook(
        () => {
          useToolStore((s) => s.useFetchAgentSkills)(true);
          useToolStore((s) => s.useFetchAgentSkillDetail)('db-1');
        },
        { wrapper },
      );
      await waitFor(() => {
        expect(useToolStore.getState().agentSkillListMap[AGENT_SKILL_LIST_KEY]).toHaveLength(2);
        expect(useToolStore.getState().agentSkillDetailMap['db-1']).toBeDefined();
      });
    };

    it('renames the list row and the loaded detail optimistically', async () => {
      await seed();
      let resolveUpdate!: (value: unknown) => void;
      vi.mocked(agentSkillService.updateSkill).mockImplementation(
        () => new Promise((resolve) => (resolveUpdate = resolve)) as any,
      );

      const operation = useToolStore.getState().updateAgentSkill({ id: 'db-1', name: 'Renamed' });

      expect(useToolStore.getState().agentSkillListMap[AGENT_SKILL_LIST_KEY][0].name).toBe(
        'Renamed',
      );
      expect(useToolStore.getState().agentSkillDetailMap['db-1'].skillDetail?.name).toBe('Renamed');

      const renamed = {
        content: 'body',
        id: 'db-1',
        identifier: 'db-1',
        name: 'Renamed',
        updatedAt: 'server',
      };
      // The refresh that follows the rename sees the server's new state.
      vi.mocked(agentSkillService.list).mockResolvedValue({
        data: [skill('db-1', 'Renamed'), skill('db-2')],
        total: 2,
      });
      await act(async () => {
        resolveUpdate(renamed);
        await operation;
      });
      expect(useToolStore.getState().agentSkillDetailMap['db-1'].skillDetail?.updatedAt).toBe(
        'server',
      );
      expect(useToolStore.getState().agentSkillListMap[AGENT_SKILL_LIST_KEY][0].name).toBe(
        'Renamed',
      );
    });

    it('rolls both copies back when the rename fails', async () => {
      await seed();
      vi.mocked(agentSkillService.updateSkill).mockRejectedValue(new Error('boom'));

      await expect(
        useToolStore.getState().updateAgentSkill({ id: 'db-1', name: 'Renamed' }),
      ).rejects.toThrow('boom');

      expect(useToolStore.getState().agentSkillListMap[AGENT_SKILL_LIST_KEY][0].name).toBe(
        'Original',
      );
      expect(useToolStore.getState().agentSkillDetailMap['db-1'].skillDetail?.name).toBe(
        'Original',
      );
    });

    it('removes a deleted skill from the list and its detail', async () => {
      await seed();
      vi.mocked(agentSkillService.deleteSkill).mockResolvedValue({ success: true });
      vi.mocked(agentSkillService.list).mockResolvedValue({ data: [skill('db-2')], total: 1 });

      await act(() => useToolStore.getState().deleteAgentSkill('db-1'));

      expect(
        useToolStore.getState().agentSkillListMap[AGENT_SKILL_LIST_KEY].map((item) => item.id),
      ).toEqual(['db-2']);
      expect(useToolStore.getState().agentSkillDetailMap['db-1']).toBeUndefined();
    });

    it('populates the store from a refresh even without a mounted list hook', async () => {
      // Mirrors the create-agent modal flow: no list hook is mounted, yet
      // `refreshAgentSkills` must populate the store for the selectors.
      vi.mocked(agentSkillService.list).mockResolvedValue({
        data: [skill('db-9', 'Imported')],
        total: 1,
      });

      await act(() => useToolStore.getState().refreshAgentSkills());

      expect(useToolStore.getState().agentSkillListMap[AGENT_SKILL_LIST_KEY]?.[0]?.id).toBe('db-9');
    });

    it('drops a refresh response that resolves after the scope switched', async () => {
      let resolveList!: (value: unknown) => void;
      vi.mocked(agentSkillService.list).mockImplementation(
        () => new Promise((resolve) => (resolveList = resolve)) as any,
      );

      const operation = useToolStore.getState().refreshAgentSkills();

      // The identity switches before the in-flight request resolves: the
      // response belongs to the previous scope and must not be written (or
      // persisted) into the next scope's partition.
      useScope(`skill-user-${randomUUID()}:personal`);
      await act(async () => {
        resolveList({ data: [skill('db-1', 'A workspace')], total: 1 });
        await operation;
      });

      expect(useToolStore.getState().agentSkillListMap[AGENT_SKILL_LIST_KEY]).toBeUndefined();
    });
  });
});
