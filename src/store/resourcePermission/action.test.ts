import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import type { ResourceGeneralAccess } from '@/services/resourcePermission';

import { resourcePermissionActions } from './action';
import { initialState } from './initialState';
import { resourceAccessResource, resourceCollaboratorsResource } from './projection';
import { useResourcePermissionStore } from './store';

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(async () => undefined),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

vi.mock('@/services/resourcePermission', () => ({
  resourcePermissionService: {
    getGeneralAccess: vi.fn(),
    setAccessLevel: vi.fn(),
  },
}));

const { resourcePermissionService } = await import('@/services/resourcePermission');

const REF = { resourceId: 'agent-1', resourceType: 'agent' } as const;
const KEY = 'agent:agent-1';

const record = (overrides: Partial<ResourceGeneralAccess> = {}): ResourceGeneralAccess => ({
  accessLevel: 'use',
  canManage: false,
  creatorId: 'creator',
  generalAccess: 'viewer',
  visibility: 'public',
  ...overrides,
});

const state = () => useResourcePermissionStore.getState();

/**
 * Mount the access sync and play the request SWR would run: the fetcher, then
 * the success / error callback the slice installed.
 */
const mountAccessSync = async () => {
  renderHook(() => resourcePermissionActions.useFetchAccess(REF));
  const { useClientDataSWR } = await import('@/libs/swr');
  const call = vi
    .mocked(useClientDataSWR)
    .mock.calls.findLast(
      ([key]) => Array.isArray(key) && key[0] === 'replica:sync' && key[1] === 'resourceAccess',
    );
  const [, fetcher, config] = call as unknown as [
    unknown,
    () => Promise<unknown>,
    { onError: (error: unknown) => void; onSuccess: (data: unknown) => void },
  ];
  return { config, fetcher };
};
const syncAccess = async () => {
  const { config, fetcher } = await mountAccessSync();
  try {
    config.onSuccess(await fetcher());
  } catch (error) {
    config.onError(error);
  }
};
const sessionCheck = () => state().accessSessionMap[`${cacheScope.get()}|${KEY}`];

describe('resourcePermissionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // State only: `reset()` also clears the replicas, which (scope not yet
    // persistable here) would block later hydrates in this scope.
    useResourcePermissionStore.setState(initialState);
  });

  it('keys the access replica per resource type and id, with a bounded persisted set', () => {
    expect(resourceAccessResource.key(REF)).toBe(KEY);
    expect(resourceAccessResource.persisted).toBe(true);
  });

  it('never persists the manager-only collaborator roster', async () => {
    // A stored roster would paint for a former manager before the server's 403.
    expect(resourceCollaboratorsResource.persisted).toBe(false);
    expect(resourceCollaboratorsResource.storage).toBeUndefined();

    renderHook(() => resourcePermissionActions.useFetchCollaborators(REF));

    expect(state().collaboratorsMap[KEY]).toBeUndefined();
    expect(state().collaboratorsReplica.entries[KEY]?.source).not.toBe('storage');
  });

  it('discards an access read still in flight when the user-data stores reset', async () => {
    // A Desktop server switch that resolves to the same scope string: the old
    // server's answer must not repopulate the store or confirm a manage grant.
    let answer!: (value: ResourceGeneralAccess) => void;
    vi.mocked(resourcePermissionService.getGeneralAccess).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { config, fetcher } = await mountAccessSync();
    const pending = fetcher();

    // Let the reset's row purge land, so later hydrates in this scope still run.
    const canPersist = vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    resourcePermissionActions.reset();
    canPersist.mockRestore();
    answer(record({ canManage: true }));
    config.onSuccess(await pending);

    expect(state().accessMap[KEY]).toBeUndefined();
    expect(sessionCheck()).toBeUndefined();
  });

  it('applies a server answer and confirms it for this session', async () => {
    vi.mocked(resourcePermissionService.getGeneralAccess).mockResolvedValue(
      record({ canManage: true }),
    );

    await syncAccess();

    expect(resourcePermissionService.getGeneralAccess).toHaveBeenCalledWith('agent', 'agent-1');
    expect(state().accessMap[KEY]?.canManage).toBe(true);
    expect(sessionCheck()).toBe('confirmed');
  });

  it('drops the record on screen and marks it denied when the server refuses access', async () => {
    useResourcePermissionStore.setState({ accessMap: { [KEY]: record({ canManage: true }) } });
    vi.mocked(resourcePermissionService.getGeneralAccess).mockRejectedValue({
      data: { code: 'FORBIDDEN' },
    });

    await syncAccess();

    expect(sessionCheck()).toBe('denied');
    expect(state().accessMap[KEY]).toBeUndefined();
  });

  it('keeps the record through a transport failure', async () => {
    useResourcePermissionStore.setState({ accessMap: { [KEY]: record() } });
    vi.mocked(resourcePermissionService.getGeneralAccess).mockRejectedValue(new Error('offline'));

    await syncAccess();

    expect(sessionCheck()).toBeUndefined();
    expect(state().accessMap[KEY]).toEqual(record());
  });

  it('updates the access level optimistically and lands the server answer', async () => {
    useResourcePermissionStore.setState({ accessMap: { [KEY]: record({ canManage: true }) } });
    let settle!: (value: ResourceGeneralAccess) => void;
    vi.mocked(resourcePermissionService.setAccessLevel).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );

    const pending = resourcePermissionActions.setAccessLevel(REF, 'edit');

    expect(state().accessMap[KEY]).toMatchObject({ accessLevel: 'edit', generalAccess: 'editor' });

    settle(record({ accessLevel: 'edit', canManage: true, generalAccess: 'editor' }));
    await pending;

    expect(state().accessMap[KEY]).toMatchObject({ accessLevel: 'edit', canManage: true });
    expect(sessionCheck()).toBe('confirmed');
  });

  it('rolls a rejected access-level change back', async () => {
    useResourcePermissionStore.setState({ accessMap: { [KEY]: record({ canManage: true }) } });
    vi.mocked(resourcePermissionService.setAccessLevel).mockRejectedValue(new Error('nope'));

    await expect(resourcePermissionActions.setAccessLevel(REF, 'edit')).rejects.toThrow('nope');

    expect(state().accessMap[KEY]).toMatchObject({ accessLevel: 'use', generalAccess: 'viewer' });
  });

  it('withdraws a stale manage grant when the server refuses a management write', async () => {
    // Confirmed manager this session, demoted before the write.
    vi.mocked(resourcePermissionService.getGeneralAccess).mockResolvedValueOnce(
      record({ canManage: true }),
    );
    await syncAccess();
    expect(sessionCheck()).toBe('confirmed');

    let answer!: (value: ResourceGeneralAccess) => void;
    vi.mocked(resourcePermissionService.getGeneralAccess).mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    vi.mocked(resourcePermissionService.setAccessLevel).mockRejectedValue({
      data: { code: 'FORBIDDEN' },
    });

    await expect(resourcePermissionActions.setAccessLevel(REF, 'edit')).rejects.toEqual({
      data: { code: 'FORBIDDEN' },
    });

    // Manage controls close before the re-fetch answers.
    expect(sessionCheck()).toBeUndefined();
    expect(resourcePermissionService.getGeneralAccess).toHaveBeenCalledTimes(2);

    answer(record({ canManage: false }));
    await vi.waitFor(() => expect(state().accessMap[KEY]?.canManage).toBe(false));
    expect(sessionCheck()).toBe('confirmed');
  });

  it('keeps the confirmation through a management write that failed in transport', async () => {
    vi.mocked(resourcePermissionService.getGeneralAccess).mockResolvedValueOnce(
      record({ canManage: true }),
    );
    await syncAccess();
    vi.mocked(resourcePermissionService.setAccessLevel).mockRejectedValue(new Error('offline'));

    await expect(resourcePermissionActions.setAccessLevel(REF, 'edit')).rejects.toThrow('offline');

    expect(sessionCheck()).toBe('confirmed');
    expect(resourcePermissionService.getGeneralAccess).toHaveBeenCalledTimes(1);
  });

  it('seeds the persisted record before anything mounts', async () => {
    const get = vi.spyOn(resourceAccessResource.storage!, 'get').mockResolvedValue({
      data: record({ accessLevel: 'edit', generalAccess: 'editor' }),
      updatedAt: 1,
    });

    // Another resource: the engine keeps a denied key's removal for the session.
    const ref = { resourceId: 'agent-2', resourceType: 'agent' } as const;

    await expect(resourcePermissionActions.preHydrateAccess(ref)).resolves.toBe(true);

    expect(get).toHaveBeenCalledWith(expect.objectContaining({ queryKey: 'agent:agent-2' }));
    expect(state().accessMap['agent:agent-2']).toMatchObject({ accessLevel: 'edit' });
    expect(state().accessReplica.entries['agent:agent-2']?.source).toBe('storage');
    // A persisted record is not this session's server answer.
    expect(state().accessSessionMap).toEqual({});
    get.mockRestore();
  });
});
