/**
 * @vitest-environment happy-dom
 *
 * The cloud-sandbox entitlement, the composer picker's environment and
 * instance lists and a bound instance's directory are `@lobechat/replica`
 * resources: a cold start paints the persisted answer while the network
 * confirms it, only slim projections reach storage, the instance list is one
 * row however many conversations ask, and scopes stay isolated.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, readReplicaStoredKeys } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { environmentService } from '@/services/environment';
import { sandboxStorageService } from '@/services/sandboxStorage';

import { sandboxActions } from './action';
import { initialState } from './initialState';
import {
  SANDBOX_SCOPE_ENTRY,
  sandboxEntitlementResource,
  sandboxEnvironmentsResource,
  sandboxInstanceDirectoryResource,
  sandboxInstancesResource,
  type SandboxPickerInstance,
} from './projection';
import { sandboxSelectors } from './selectors';
import { useSandboxStore } from './store';

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

/** Never-resolving fetch: what the store holds can only have come from storage. */
const pending = () => new Promise<never>(() => {});

type ListedEnvironments = Awaited<ReturnType<typeof environmentService.listEnvironments>>;
type ListedInstances = Awaited<ReturnType<typeof sandboxStorageService.listInstances>>;
type InstanceDetail = Awaited<ReturnType<typeof sandboxStorageService.getInstance>>;

const rawEnvironment = {
  configuration: {
    env: { API_TOKEN: 'secret-value' },
    sources: [
      { kind: 'git', url: 'https://x-access-token:ghp_secret@github.com/lobehub/lobehub.git' },
    ],
  },
  createdAt: new Date('2026-10-01'),
  description: null,
  id: 'env-1',
  name: 'Lobehub Dev',
  updatedAt: new Date('2026-10-01'),
  userId: 'user-1',
  visibility: 'private',
  workspaceId: 'ws-1',
};

const rawInstance = (overrides: Record<string, unknown> = {}) => ({
  buildError: 'npm ERR! token=secret-in-log',
  buildId: null,
  buildable: true,
  configurationSnapshot: { env: { API_TOKEN: 'secret-value' } },
  createdAt: new Date('2026-10-01T00:00:00Z'),
  environmentId: 'env-1',
  id: 'inst-1',
  inUse: false,
  inUseByThisTopic: false,
  isDefault: true,
  name: 'main-checkout',
  snapshot: null,
  status: 'ready',
  workingDirectory: 'lobehub-main',
  ...overrides,
});

const listed = (...instances: ReturnType<typeof rawInstance>[]) =>
  ({ instances, occupancyUnavailable: false }) as unknown as ListedInstances;

const pickerInstance = (overrides: Partial<SandboxPickerInstance> = {}): SandboxPickerInstance => ({
  createdAt: '2026-10-01T00:00:00.000Z',
  environmentId: 'env-1',
  id: 'inst-1',
  inUse: false,
  inUseByThisTopic: false,
  isDefault: true,
  name: 'main-checkout',
  status: 'ready',
  workingDirectory: 'lobehub-main',
  ...overrides,
});

const state = () => useSandboxStore.getState();

describe('sandbox replicas', () => {
  const scopes = new Set<string>();
  let scope = '';

  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  const resources = [
    sandboxEntitlementResource,
    sandboxEnvironmentsResource,
    sandboxInstancesResource,
    sandboxInstanceDirectoryResource,
  ] as const;

  const stored = async (
    resource: (typeof resources)[number],
    queryKey = SANDBOX_SCOPE_ENTRY as string,
  ) => (await resource.storage!.get({ queryKey, scope }))?.data;

  beforeEach(() => {
    useScope(`sandbox-user-${randomUUID()}:ws-1`);
    useSandboxStore.setState({ ...initialState });
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) =>
        resources.flatMap((resource) =>
          [SANDBOX_SCOPE_ENTRY, 'inst-1', 'inst-gone'].map((queryKey) =>
            resource.storage!.remove({ queryKey, scope: value }),
          ),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
  });

  it('paints the entitlement, both picker lists and the directory before the network answers', async () => {
    await sandboxEntitlementResource.storage!.set(
      { queryKey: SANDBOX_SCOPE_ENTRY, scope },
      { data: { entitled: true, quotaBytes: 1024 }, updatedAt: 1 },
    );
    await sandboxEnvironmentsResource.storage!.set(
      { queryKey: SANDBOX_SCOPE_ENTRY, scope },
      {
        data: [
          {
            id: 'env-1',
            kind: 'code',
            name: 'Lobehub Dev',
            userId: 'user-1',
            visibility: 'private',
            workspaceId: 'ws-1',
          },
        ],
        updatedAt: 1,
      },
    );
    await sandboxInstancesResource.storage!.set(
      { queryKey: SANDBOX_SCOPE_ENTRY, scope },
      { data: { instances: [pickerInstance()], topicId: 'topic-1' }, updatedAt: 1 },
    );
    await sandboxInstanceDirectoryResource.storage!.set(
      { queryKey: 'inst-1', scope },
      { data: { workingDirectory: 'lobehub-main' }, updatedAt: 1 },
    );
    vi.spyOn(sandboxStorageService, 'getEntitlement').mockImplementation(pending);
    vi.spyOn(environmentService, 'listEnvironments').mockImplementation(pending);
    vi.spyOn(sandboxStorageService, 'listInstances').mockImplementation(pending);
    vi.spyOn(sandboxStorageService, 'getInstance').mockImplementation(pending);

    renderHook(
      () => {
        sandboxActions.useFetchEntitlement(true);
        sandboxActions.useFetchPickerEnvironments(true);
        sandboxActions.useFetchPickerInstances(true, 'topic-1');
        sandboxActions.useFetchInstanceDirectory('inst-1');
      },
      { wrapper },
    );

    await waitFor(() => expect(sandboxSelectors.entitlement(state())?.entitled).toBe(true));
    await waitFor(() =>
      expect(sandboxSelectors.pickerEnvironments(state())?.[0].name).toBe('Lobehub Dev'),
    );
    await waitFor(() =>
      expect(sandboxSelectors.pickerInstances('topic-1')(state())?.[0].name).toBe('main-checkout'),
    );
    await waitFor(() =>
      expect(sandboxSelectors.instanceDirectory('inst-1')(state())).toBe('lobehub-main'),
    );
  });

  it('persists only the slim projections: no configuration, env, source URL or build log', async () => {
    vi.spyOn(environmentService, 'listEnvironments').mockResolvedValue({
      environments: [rawEnvironment],
    } as unknown as ListedEnvironments);
    vi.spyOn(sandboxStorageService, 'listInstances').mockResolvedValue(listed(rawInstance()));
    vi.spyOn(sandboxStorageService, 'getInstance').mockResolvedValue(
      rawInstance() as unknown as InstanceDetail,
    );

    renderHook(
      () => {
        sandboxActions.useFetchPickerEnvironments(true);
        sandboxActions.useFetchPickerInstances(true, 'topic-1');
        sandboxActions.useFetchInstanceDirectory('inst-1');
      },
      { wrapper },
    );

    await waitFor(async () => expect(await stored(sandboxEnvironmentsResource)).toHaveLength(1));
    await waitFor(async () => expect(await stored(sandboxInstancesResource)).toBeDefined());
    await waitFor(async () =>
      expect(await stored(sandboxInstanceDirectoryResource, 'inst-1')).toBeDefined(),
    );

    expect(await stored(sandboxEnvironmentsResource)).toEqual([
      {
        id: 'env-1',
        kind: 'code',
        name: 'Lobehub Dev',
        userId: 'user-1',
        visibility: 'private',
        workspaceId: 'ws-1',
      },
    ]);
    expect(await stored(sandboxInstanceDirectoryResource, 'inst-1')).toEqual({
      workingDirectory: 'lobehub-main',
    });

    const payload = JSON.stringify([
      await stored(sandboxEnvironmentsResource),
      await stored(sandboxInstancesResource),
      await stored(sandboxInstanceDirectoryResource, 'inst-1'),
    ]);
    for (const leaked of ['configuration', 'secret', 'ghp_', 'buildError', 'npm ERR']) {
      expect(payload).not.toContain(leaked);
    }
  });

  // Regression: keyed per topic, every conversation visited persisted its own
  // full copy of the instance list.
  it('keeps one persisted instance list however many conversations ask', async () => {
    const listInstances = vi
      .spyOn(sandboxStorageService, 'listInstances')
      .mockImplementation(async ({ topicId } = {}) =>
        listed(rawInstance({ inUse: true, inUseByThisTopic: topicId === 'topic-1' })),
      );

    const { rerender } = renderHook(
      ({ topicId }) => sandboxActions.useFetchPickerInstances(true, topicId),
      { initialProps: { topicId: 'topic-1' }, wrapper },
    );
    await waitFor(async () =>
      expect((await stored(sandboxInstancesResource))?.topicId).toBe('topic-1'),
    );

    rerender({ topicId: 'topic-2' });
    await waitFor(async () =>
      expect((await stored(sandboxInstancesResource))?.topicId).toBe('topic-2'),
    );

    expect(listInstances).toHaveBeenCalledWith({ topicId: 'topic-2', withSizes: false });
    expect(await readReplicaStoredKeys(sandboxInstancesResource)).toEqual([SANDBOX_SCOPE_ENTRY]);
  });

  // Regression: every topic shares one entry and one storage key, so the
  // replica's own guard could not tell topic-1's late answer from topic-2's and
  // let it overwrite topic-2's — the selector then masked topic-2's own copy as
  // held by another conversation until the next revalidation.
  it('drops a superseded conversation’s answer that lands after the current one', async () => {
    let answerTopic1!: () => void;
    vi.spyOn(sandboxStorageService, 'listInstances').mockImplementation(({ topicId } = {}) => {
      const answer = listed(rawInstance({ inUse: true, inUseByThisTopic: true }));
      if (topicId !== 'topic-1') return Promise.resolve(answer);
      return new Promise((resolve) => {
        answerTopic1 = () => resolve(answer);
      });
    });

    const { rerender } = renderHook(
      ({ topicId }) => sandboxActions.useFetchPickerInstances(true, topicId),
      { initialProps: { topicId: 'topic-1' }, wrapper },
    );
    await waitFor(() => expect(answerTopic1).toBeTypeOf('function'));

    rerender({ topicId: 'topic-2' });
    await waitFor(() =>
      expect(state().sandboxInstancesMap[SANDBOX_SCOPE_ENTRY]?.topicId).toBe('topic-2'),
    );

    await act(async () => {
      answerTopic1();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(state().sandboxInstancesMap[SANDBOX_SCOPE_ENTRY]?.topicId).toBe('topic-2');
    expect(sandboxSelectors.pickerInstances('topic-2')(state())?.[0].inUseByThisTopic).toBe(true);
    await waitFor(async () =>
      expect((await stored(sandboxInstancesResource))?.topicId).toBe('topic-2'),
    );
  });

  it('never reads another conversation’s answer as this one holding the copy', () => {
    useSandboxStore.setState({
      sandboxInstancesMap: {
        [SANDBOX_SCOPE_ENTRY]: {
          instances: [pickerInstance({ inUse: true, inUseByThisTopic: true })],
          topicId: 'topic-1',
        },
      },
    });

    expect(sandboxSelectors.pickerInstances('topic-1')(state())?.[0].inUseByThisTopic).toBe(true);
    // Held by topic-1: from topic-2 it is somebody else's run until topic-2's answer lands.
    expect(sandboxSelectors.pickerInstances('topic-2')(state())?.[0]).toMatchObject({
      inUse: true,
      inUseByThisTopic: false,
    });
    expect(sandboxSelectors.pickerInstances(undefined)(state())?.[0].inUseByThisTopic).toBe(false);
  });

  // Regression: a listing already in flight when a copy is created answered
  // without it, and replacing the whole entry erased the "Building" row (and
  // the chip bound to it) until the next listing.
  it('keeps a just-created copy when a listing that started before it lands', async () => {
    let answerOld!: () => void;
    const listInstances = vi
      .spyOn(sandboxStorageService, 'listInstances')
      .mockResolvedValueOnce(listed(rawInstance()))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerOld = () => resolve(listed(rawInstance()));
          }),
      );
    renderHook(() => sandboxActions.useFetchPickerInstances(true, 'topic-1'), { wrapper });
    await waitFor(() =>
      expect(state().sandboxInstancesMap[SANDBOX_SCOPE_ENTRY]?.instances).toHaveLength(1),
    );

    // A revalidation starts, then the copy is created while it is in flight.
    const revalidating = sandboxActions.mutatePickerInstances();
    await waitFor(() => expect(answerOld).toBeTypeOf('function'));
    await act(() =>
      sandboxActions.mutatePickerInstances(
        (previous) =>
          previous && {
            ...previous,
            instances: [
              ...previous.instances,
              pickerInstance({ id: 'inst-2', isDefault: false, status: 'pending' }),
            ],
          },
        { revalidate: false },
      ),
    );

    await act(async () => {
      answerOld();
      await revalidating;
    });

    const ids = () =>
      sandboxSelectors
        .pickerInstances('topic-1')(state())
        ?.map((i) => i.id);
    expect(ids()).toEqual(['inst-1', 'inst-2']);
    await waitFor(async () =>
      expect((await stored(sandboxInstancesResource))?.instances.map((i) => i.id)).toEqual([
        'inst-1',
      ]),
    );

    // A listing that started after the creation is authoritative: if it does
    // not list the copy, the copy is gone.
    listInstances.mockResolvedValue(listed(rawInstance()));
    await act(() => sandboxActions.mutatePickerInstances());
    await waitFor(() => expect(ids()).toEqual(['inst-1']));
  });

  it('keeps a just-created copy in memory until the server lists it', async () => {
    const listInstances = vi
      .spyOn(sandboxStorageService, 'listInstances')
      .mockResolvedValue(listed(rawInstance()));
    renderHook(() => sandboxActions.useFetchPickerInstances(true, 'topic-1'), { wrapper });
    await waitFor(async () =>
      expect((await stored(sandboxInstancesResource))?.instances).toHaveLength(1),
    );

    await act(() =>
      sandboxActions.mutatePickerInstances(
        (previous) =>
          previous && {
            ...previous,
            instances: [
              ...previous.instances,
              pickerInstance({ id: 'inst-2', isDefault: false, status: 'pending' }),
            ],
          },
        { revalidate: false },
      ),
    );

    expect(
      sandboxSelectors
        .pickerInstances('topic-1')(state())
        ?.map((i) => i.id),
    ).toEqual(['inst-1', 'inst-2']);
    expect((await stored(sandboxInstancesResource))?.instances.map((i) => i.id)).toEqual([
      'inst-1',
    ]);

    listInstances.mockResolvedValue(
      listed(rawInstance(), rawInstance({ id: 'inst-2', isDefault: false })),
    );
    await act(() => sandboxActions.mutatePickerInstances());
    await waitFor(async () =>
      expect((await stored(sandboxInstancesResource))?.instances.map((i) => i.id)).toEqual([
        'inst-1',
        'inst-2',
      ]),
    );
  });

  it('settles on a gone instance without persisting it, and forgets its old directory', async () => {
    await sandboxInstanceDirectoryResource.storage!.set(
      { queryKey: 'inst-gone', scope },
      { data: { workingDirectory: 'old-dir' }, updatedAt: 1 },
    );
    vi.spyOn(sandboxStorageService, 'getInstance').mockResolvedValue(null);

    renderHook(() => sandboxActions.useFetchInstanceDirectory('inst-gone'), { wrapper });

    await waitFor(() =>
      expect(sandboxSelectors.instanceDirectory('inst-gone')(state())).toBeNull(),
    );
    await waitFor(async () =>
      expect(await stored(sandboxInstanceDirectoryResource, 'inst-gone')).toBeUndefined(),
    );
  });

  it('drops the previous workspace’s entitlement on a scope switch', async () => {
    const getEntitlement = vi
      .spyOn(sandboxStorageService, 'getEntitlement')
      .mockResolvedValue({ entitled: true, quotaBytes: 1024 });
    const { rerender } = renderHook(() => sandboxActions.useFetchEntitlement(true), { wrapper });
    await waitFor(() => expect(sandboxSelectors.entitlement(state())?.entitled).toBe(true));

    useScope(`${scope.split(':')[0]}:ws-2`);
    getEntitlement.mockImplementation(pending);
    rerender();

    expect(sandboxSelectors.entitlement(state())).toBeUndefined();
  });

  it('resets with the other user-data stores', () => {
    useSandboxStore.setState({
      sandboxEntitlementMap: { [SANDBOX_SCOPE_ENTRY]: { entitled: true, quotaBytes: null } },
    });

    sandboxActions.reset();

    expect(sandboxSelectors.entitlement(state())).toBeUndefined();
  });
});
