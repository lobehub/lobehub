/**
 * @vitest-environment happy-dom
 *
 * The project list and project pages are replicas: they paint from the
 * persisted copy on the first frame, the network only confirms, and a rename
 * or delete reaches the list row and every loaded project page at once.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { projectService } from '@/services/project';

import type { ProjectDetail, ProjectListItem } from './projection';
import { PROJECT_LIST_KEY, projectDetailResource, projectListResource } from './projection';
import {
  initialProjectState,
  useCurrentProjectDetail,
  useCurrentProjectList,
  useProjectStore,
} from './store';

const mocks = vi.hoisted(() => ({
  activeWorkspaceId: null as string | null,
  enableChannels: false,
  refreshChannelList: vi.fn(),
  refreshProjectTopics: vi.fn(),
  syncFavoriteSnapshot: vi.fn(),
}));

vi.mock('@/store/serverConfig', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getServerConfigStoreState: () => ({ featureFlags: { enableChannels: mocks.enableChannels } }),
}));

vi.mock('@/store/channel', () => ({
  channelActions: { refreshList: mocks.refreshChannelList },
}));

vi.mock('@/store/projectWorkingDirectory', () => ({
  useProjectDirectoryStore: {
    getState: () => ({ refreshProjectTopics: mocks.refreshProjectTopics }),
  },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => mocks.activeWorkspaceId,
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock('@/store/home', () => ({
  useHomeStore: { getState: () => ({ syncFavoriteSnapshot: mocks.syncFavoriteSnapshot }) },
}));

vi.mock('@/services/project', () => ({
  projectService: {
    addAgent: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    detail: vi.fn(),
    listAll: vi.fn(),
    move: vi.fn(),
    removeAgent: vi.fn(),
    replaceCoordinator: vi.fn(),
    update: vi.fn(),
    updateKnowledgeBase: vi.fn(),
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

const project = (id: string, name = id): ProjectListItem =>
  ({ id, name, slug: `${id}-slug` }) as ProjectListItem;
const detailOf = (item: ProjectListItem): ProjectDetail => ({ project: item }) as ProjectDetail;
const ok = <T>(data: T) => ({ data, message: 'ok', success: true as const });

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const LIST_STORAGE_KEY = projectListResource.storageKey({});

describe('project store replicas', () => {
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
    mocks.activeWorkspaceId = null;
    mocks.enableChannels = false;
    useScope(`project-user-${randomUUID()}:personal`);
    act(() => useProjectStore.setState(initialProjectState));
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((value) => [
        projectListResource.storage!.remove({ queryKey: LIST_STORAGE_KEY, scope: value }),
        projectDetailResource.storage!.remove({ queryKey: 'launch', scope: value }),
      ]),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted list before the network answers', async () => {
    await projectListResource.storage!.set(
      { queryKey: LIST_STORAGE_KEY, scope },
      { data: [project('p1', 'Cached')], updatedAt: 1 },
    );
    vi.mocked(projectService.listAll).mockImplementation(pending);

    const sync = renderHook(() => useProjectStore((s) => s.useFetchProjectList)(true), {
      wrapper,
    });
    const list = renderHook(() => useCurrentProjectList());

    await waitFor(() => expect(list.result.current.map((p) => p.name)).toEqual(['Cached']));
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('replaces the list with the server response and persists it', async () => {
    vi.mocked(projectService.listAll).mockResolvedValue(ok([project('p1', 'Server')]) as any);

    renderHook(() => useProjectStore((s) => s.useFetchProjectList)(true), { wrapper });

    await waitFor(() =>
      expect(useProjectStore.getState().projectListMap[PROJECT_LIST_KEY]?.[0]?.name).toBe('Server'),
    );
    await waitFor(async () =>
      expect(
        (await projectListResource.storage!.get({ queryKey: LIST_STORAGE_KEY, scope }))?.data,
      ).toEqual([project('p1', 'Server')]),
    );
  });

  it('paints a project page from the persisted copy, keyed by the route slug', async () => {
    await projectDetailResource.storage!.set(
      { queryKey: 'launch', scope },
      { data: detailOf(project('p1', 'Cached page')), updatedAt: 1 },
    );
    vi.mocked(projectService.detail).mockImplementation(pending);

    renderHook(() => useProjectStore((s) => s.useFetchProjectDetail)('launch'), { wrapper });
    const detail = renderHook(() => useCurrentProjectDetail('launch'));

    await waitFor(() => expect(detail.result.current?.project.name).toBe('Cached page'));
  });

  it('drops the previous identity’s projects before the next one paints', async () => {
    vi.mocked(projectService.listAll).mockResolvedValue(ok([project('p1', 'Mine')]) as any);
    const sync = renderHook(() => useProjectStore((s) => s.useFetchProjectList)(true), {
      wrapper,
    });
    await waitFor(() => expect(useProjectStore.getState().projectListMap.all).toHaveLength(1));

    vi.mocked(projectService.listAll).mockImplementation(pending);
    useScope(`project-user-${randomUUID()}:personal`);
    sync.rerender();

    await waitFor(() => expect(useProjectStore.getState().projectListMap.all).toBeUndefined());
  });

  describe('moveProject', () => {
    const deferred = () => {
      let resolve!: (value: unknown) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, reject, resolve };
    };

    const loadList = async (...ids: string[]) => {
      vi.mocked(projectService.listAll).mockResolvedValue(ok(ids.map((id) => project(id))) as any);
      renderHook(() => useProjectStore((s) => s.useFetchProjectList)(true), { wrapper });
      await waitFor(() =>
        expect(useProjectStore.getState().projectListMap[PROJECT_LIST_KEY]).toHaveLength(
          ids.length,
        ),
      );
    };
    // Positions, not array order: the shared list keeps its own order.
    const names = () =>
      useProjectStore
        .getState()
        .projectListMap[PROJECT_LIST_KEY]?.toSorted(
          (a, b) => (a.sortOrder ?? -1) - (b.sortOrder ?? -1),
        )
        .map((p) => p.id);

    it('moves the row at once and sends queued moves only after the earlier one lands', async () => {
      await loadList('a', 'b', 'c');
      const first = deferred();
      vi.mocked(projectService.move)
        .mockReturnValueOnce(first.promise as any)
        .mockResolvedValueOnce(ok(undefined) as any);
      const { moveProject } = useProjectStore.getState();

      const one = moveProject('c', ['c', 'a', 'b']);
      const two = moveProject('b', ['b', 'c', 'a']);

      expect(names()).toEqual(['b', 'c', 'a']);
      await Promise.resolve();
      expect(projectService.move).toHaveBeenCalledTimes(1);
      expect(projectService.move).toHaveBeenLastCalledWith('c', { beforeId: 'a' });

      first.resolve(ok(undefined));
      await Promise.all([one, two]);
      expect(projectService.move).toHaveBeenCalledTimes(2);
      expect(projectService.move).toHaveBeenLastCalledWith('b', { beforeId: 'c' });
    });

    it('keeps the shared list order and reads back the server once the queue is idle', async () => {
      await loadList('a', 'b', 'c');
      vi.mocked(projectService.move).mockResolvedValue(ok(undefined) as any);
      const fetchesBefore = vi.mocked(projectService.listAll).mock.calls.length;
      const serverOrder = [
        { ...project('a'), sortOrder: 1 },
        { ...project('b'), sortOrder: 2 },
        { ...project('c'), sortOrder: 0 },
      ];
      vi.mocked(projectService.listAll).mockResolvedValue(ok(serverOrder) as any);

      await useProjectStore.getState().moveProject('c', ['c', 'a', 'b']);

      const raw = () =>
        useProjectStore.getState().projectListMap[PROJECT_LIST_KEY]?.map((p) => p.id);
      expect(raw()).toEqual(['a', 'b', 'c']);
      expect(names()).toEqual(['c', 'a', 'b']);
      await waitFor(() =>
        expect(vi.mocked(projectService.listAll).mock.calls.length).toBe(fetchesBefore + 1),
      );
    });

    it('drops moves queued behind a failed one and refetches the server order', async () => {
      await loadList('a', 'b', 'c');
      const first = deferred();
      vi.mocked(projectService.move).mockReturnValueOnce(first.promise as any);
      const { moveProject } = useProjectStore.getState();

      const one = moveProject('c', ['c', 'a', 'b']);
      const two = moveProject('b', ['b', 'c', 'a']);
      vi.mocked(projectService.listAll).mockResolvedValue(
        ok(['a', 'b', 'c'].map((id) => project(id))) as any,
      );

      first.reject(new Error('boom'));
      await expect(one).rejects.toThrow('boom');
      await two;

      expect(projectService.move).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(names()).toEqual(['a', 'b', 'c']));
    });

    it('ignores a drop made while a failed move is being reconciled', async () => {
      await loadList('a', 'b', 'c');
      vi.mocked(projectService.move).mockRejectedValueOnce(new Error('boom'));
      const refetch = deferred();
      const { moveProject } = useProjectStore.getState();

      const failed = moveProject('c', ['c', 'a', 'b']);
      vi.mocked(projectService.listAll).mockReturnValue(refetch.promise as any);
      await vi.waitFor(() => expect(projectService.listAll).toHaveBeenCalledTimes(2));

      // The list still shows the failed optimistic order while the refetch is in flight.
      const late = moveProject('c', ['a', 'b', 'c']);
      expect(names()).toEqual(['c', 'a', 'b']);

      refetch.resolve(ok(['a', 'b', 'c'].map((id) => project(id))));
      await expect(failed).rejects.toThrow('boom');
      await late;

      expect(projectService.move).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(names()).toEqual(['a', 'b', 'c']));
    });
  });

  describe('mutations', () => {
    const seed = () => {
      const original = project('p1', 'Original');
      act(() => {
        useProjectStore.getState(); // store constructed
        useProjectStore.setState(initialProjectState);
      });
      // Land both copies through the replicas (not a raw setState) so they hold bookkeeping.
      vi.mocked(projectService.listAll).mockResolvedValue(ok([original, project('p2')]) as any);
      vi.mocked(projectService.detail).mockResolvedValue(ok(detailOf(original)) as any);
      renderHook(
        () => {
          useProjectStore((s) => s.useFetchProjectList)(true);
          useProjectStore((s) => s.useFetchProjectDetail)('launch');
        },
        { wrapper },
      );
      return original;
    };
    const waitSeeded = () =>
      waitFor(() => {
        expect(useProjectStore.getState().projectListMap.all).toHaveLength(2);
        expect(useProjectStore.getState().projectDetailMap.launch).toBeDefined();
      });

    it('renames the list row and the project page optimistically', async () => {
      const original = seed();
      await waitSeeded();
      let resolveUpdate!: (value: unknown) => void;
      vi.mocked(projectService.update).mockImplementation(
        () => new Promise((resolve) => (resolveUpdate = resolve)) as any,
      );

      const operation = useProjectStore.getState().updateProject('p1', { name: 'Renamed' });

      expect(useProjectStore.getState().projectListMap.all[0].name).toBe('Renamed');
      expect(useProjectStore.getState().projectDetailMap.launch.project.name).toBe('Renamed');

      const renamed = { ...original, name: 'Renamed', updatedAt: 'server' };
      // The refresh that follows the rename sees the server's new state.
      vi.mocked(projectService.listAll).mockResolvedValue(ok([renamed, project('p2')]) as any);
      await act(async () => {
        resolveUpdate(ok(renamed));
        await operation;
      });
      expect(useProjectStore.getState().projectListMap.all[0]).toMatchObject({
        name: 'Renamed',
        updatedAt: 'server',
      });
      expect(useProjectStore.getState().projectDetailMap.launch.project.updatedAt).toBe('server');
    });

    it('rolls both copies back when the rename fails', async () => {
      seed();
      await waitSeeded();
      vi.mocked(projectService.update).mockRejectedValue(new Error('boom'));

      await expect(
        useProjectStore.getState().updateProject('p1', { name: 'Renamed' }),
      ).rejects.toThrow('boom');

      expect(useProjectStore.getState().projectListMap.all[0].name).toBe('Original');
      expect(useProjectStore.getState().projectDetailMap.launch.project.name).toBe('Original');
    });

    it('removes a deleted project from the list and its page', async () => {
      seed();
      await waitSeeded();
      vi.mocked(projectService.delete).mockResolvedValue(ok(project('p1')) as any);
      vi.mocked(projectService.listAll).mockResolvedValue(ok([project('p2')]) as any);

      await act(() => useProjectStore.getState().deleteProject('p1'));

      expect(useProjectStore.getState().projectListMap.all.map((p) => p.id)).toEqual(['p2']);
      expect(useProjectStore.getState().projectDetailMap.launch).toBeUndefined();
    });

    it('drops a removed member from the page at once, then reconciles with the server', async () => {
      const original = seed();
      await waitSeeded();
      const member = { agent: { id: 'agent-1' }, binding: { agentId: 'agent-1' } };
      act(() =>
        useProjectStore.setState({
          projectDetailMap: {
            launch: { ...detailOf(original), agents: [member] } as unknown as ProjectDetail,
          },
        }),
      );
      let resolveRemove!: (value: unknown) => void;
      vi.mocked(projectService.removeAgent).mockImplementation(
        () => new Promise((resolve) => (resolveRemove = resolve)) as any,
      );
      vi.mocked(projectService.detail).mockResolvedValue(
        ok({ ...detailOf(original), agents: [] }) as any,
      );

      const operation = useProjectStore.getState().removeProjectAgent('p1', 'agent-1');
      expect(useProjectStore.getState().projectDetailMap.launch.agents).toEqual([]);

      await act(async () => {
        resolveRemove(ok(true));
        await operation;
      });
      expect(projectService.removeAgent).toHaveBeenCalledWith('p1', 'agent-1');
      expect(projectService.detail).toHaveBeenLastCalledWith('launch');
    });

    it('reloads the page, the list and the conversations once the main agent is replaced', async () => {
      const original = seed();
      await waitSeeded();
      vi.mocked(projectService.replaceCoordinator).mockResolvedValue(ok(original) as any);
      vi.mocked(projectService.detail).mockResolvedValue(
        ok({ ...detailOf(original), project: { ...original, coordinatorAgentId: 'lead' } }) as any,
      );
      vi.mocked(projectService.listAll).mockClear();

      await act(() => useProjectStore.getState().replaceProjectCoordinator('p1', 'lead'));

      expect(projectService.replaceCoordinator).toHaveBeenCalledWith('p1', 'lead');
      expect(useProjectStore.getState().projectDetailMap.launch.project.coordinatorAgentId).toBe(
        'lead',
      );
      await waitFor(() => expect(projectService.listAll).toHaveBeenCalled());
      expect(mocks.refreshProjectTopics).toHaveBeenCalledWith('p1');
    });

    it('restores a knowledge toggle from the server when the update fails', async () => {
      const original = seed();
      await waitSeeded();
      const binding = {
        binding: { enabled: true, knowledgeBaseId: 'kb-1' },
        knowledgeBase: { id: 'kb-1' },
      };
      const seeded = { ...detailOf(original), knowledgeBases: [binding] };
      act(() =>
        useProjectStore.setState({
          projectDetailMap: { launch: seeded as unknown as ProjectDetail },
        }),
      );
      vi.mocked(projectService.updateKnowledgeBase).mockRejectedValue(new Error('denied'));
      vi.mocked(projectService.detail).mockResolvedValue(ok(seeded) as any);

      await expect(
        useProjectStore.getState().updateProjectKnowledgeBase('p1', 'kb-1', { enabled: false }),
      ).rejects.toThrow('denied');

      expect(
        useProjectStore.getState().projectDetailMap.launch.knowledgeBases?.[0].binding.enabled,
      ).toBe(true);
    });

    it('creates the project in the active workspace and shows it at the top', async () => {
      seed();
      await waitSeeded();
      mocks.activeWorkspaceId = 'workspace-1';
      const created = project('p3', 'Launch');
      vi.mocked(projectService.create).mockResolvedValue(ok(created) as any);
      // Keep the follow-up refresh in flight: the new row must show before it lands.
      vi.mocked(projectService.listAll).mockImplementation(pending);

      await act(async () => {
        await expect(
          useProjectStore
            .getState()
            .createProject({ identifier: 'LOB', name: 'Launch', slug: 'launch' }),
        ).resolves.toBe(created);
      });

      expect(projectService.create).toHaveBeenCalledWith(
        { identifier: 'LOB', name: 'Launch', slug: 'launch' },
        'workspace-1',
      );
      expect(useProjectStore.getState().projectListMap.all[0].id).toBe('p3');
    });
    it("refetches Channels for the new project's default Channel only while they are on", async () => {
      seed();
      await waitSeeded();
      vi.mocked(projectService.create).mockResolvedValue(ok(project('p3', 'Launch')) as any);
      vi.mocked(projectService.listAll).mockImplementation(pending);
      mocks.refreshChannelList.mockResolvedValue(undefined);

      await act(() => useProjectStore.getState().createProject({ name: 'Launch' }));
      expect(mocks.refreshChannelList).not.toHaveBeenCalled();

      mocks.enableChannels = true;
      await act(() => useProjectStore.getState().createProject({ name: 'Launch' }));
      await waitFor(() => expect(mocks.refreshChannelList).toHaveBeenCalledTimes(1));
    });
    it('refreshes a favorited project when its name or logo changes', async () => {
      seed();
      await waitSeeded();
      const renamed = { ...project('p1', 'Renamed'), avatar: '🚀' };
      vi.mocked(projectService.update).mockResolvedValue(ok(renamed) as any);

      await act(async () => {
        await useProjectStore.getState().updateProject('p1', { avatar: '🚀', name: 'Renamed' });
      });
      await waitFor(() =>
        expect(mocks.syncFavoriteSnapshot).toHaveBeenCalledWith('project', 'p1', {
          icon: '🚀',
          title: 'Renamed',
        }),
      );

      mocks.syncFavoriteSnapshot.mockClear();
      vi.mocked(projectService.update).mockResolvedValue(ok(project('p1', 'Renamed')) as any);
      await act(async () => {
        await useProjectStore.getState().updateProject('p1', { description: 'Plan' } as any);
      });
      expect(mocks.syncFavoriteSnapshot).not.toHaveBeenCalled();
    });
  });
});
