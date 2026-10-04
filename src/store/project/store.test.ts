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

const mocks = vi.hoisted(() => ({ activeWorkspaceId: null as string | null }));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => mocks.activeWorkspaceId,
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock('@/services/project', () => ({
  projectService: {
    create: vi.fn(),
    delete: vi.fn(),
    detail: vi.fn(),
    listAll: vi.fn(),
    update: vi.fn(),
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
  });
});
