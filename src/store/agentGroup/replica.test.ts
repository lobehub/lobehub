/**
 * @vitest-environment happy-dom
 *
 * The agent group store is two `@lobechat/replica` resources: the group list
 * (`groups`) and the per-group detail (`groupMap`). The persisted projection
 * paints while the network confirms it, a gone group is dropped from every view
 * that holds it (and from storage), and one group row is patched everywhere it
 * appears in a single fan-out.
 */
import { randomUUID } from 'node:crypto';

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatGroupItem } from '@/database/schemas/chatGroup';
import { cacheScope, createReplicaState } from '@/libs/replica';
import { chatGroupService } from '@/services/chatGroup';

import { initialChatGroupState } from './initialState';
import { agentGroupDetailResource, agentGroupListResource } from './projection';
import { useAgentGroupStore } from './store';

vi.mock('@/services/chatGroup', () => ({
  chatGroupService: {
    getGroupDetail: vi.fn(),
    getGroups: vi.fn(),
    updateGroup: vi.fn(),
  },
}));

/** Shared agent-store probe, so the detail side effects can be asserted. */
const agentStoreMock = vi.hoisted(() => ({
  agentMap: {} as Record<string, any>,
  internal_dispatchAgentMap: vi.fn(),
  setActiveAgentId: vi.fn(),
}));

vi.mock('@/store/agent', () => ({
  getAgentStoreState: vi.fn(() => agentStoreMock),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: { setState: vi.fn() },
}));

const getGroupDetail = chatGroupService.getGroupDetail as unknown as ReturnType<typeof vi.fn>;
const getGroups = chatGroupService.getGroups as unknown as ReturnType<typeof vi.fn>;

const groupRow = (id: string, title = `Group ${id}`): ChatGroupItem =>
  ({
    accessedAt: new Date(),
    avatar: null,
    backgroundColor: null,
    clientId: null,
    config: null,
    content: null,
    createdAt: new Date(),
    deletedAt: null,
    description: null,
    editorData: null,
    groupId: null,
    id,
    isDeleted: null,
    marketIdentifier: null,
    pinned: false,
    title,
    updatedAt: new Date(),
    userId: 'user-1',
    visibility: 'public',
    workspaceId: null,
  }) as ChatGroupItem;

const groupDetail = (id: string, title = `Group ${id}`) =>
  ({ ...groupRow(id, title), agents: [], supervisorAgentId: `${id}-supervisor` }) as any;

/** Never-resolving fetch: what the store holds can only have come from storage. */
const pending = () => new Promise<never>(() => {});

const LIST_STORAGE_KEY = agentGroupListResource.storageKey({});
const detailStorageKey = (groupId: string) => agentGroupDetailResource.storageKey({ groupId });

describe('agentGroup store replica', () => {
  const scopes = new Set<string>();

  const createScope = (prefix = 'agent-group-user') => {
    const scope = `${prefix}:${randomUUID()}:personal`;
    scopes.add(scope);
    vi.spyOn(cacheScope, 'get').mockReturnValue(scope);
    vi.spyOn(cacheScope, 'use').mockReturnValue(scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    return scope;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    agentStoreMock.agentMap = {};
    useAgentGroupStore.setState({ ...initialChatGroupState });
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((scope) => [
        agentGroupListResource.storage!.remove({ queryKey: LIST_STORAGE_KEY, scope }),
        agentGroupDetailResource.storage!.remove({ queryKey: detailStorageKey('g1'), scope }),
        agentGroupDetailResource.storage!.remove({ queryKey: detailStorageKey('g2'), scope }),
      ]),
    );
    cleanup();
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted group list before the network answers', async () => {
    const scope = createScope();
    await agentGroupListResource.storage!.set(
      { queryKey: LIST_STORAGE_KEY, scope },
      { data: [groupRow('cached', 'Cached group')], updatedAt: 1 },
    );
    getGroups.mockImplementation(pending);

    void useAgentGroupStore.getState().loadGroups();

    await vi.waitFor(() =>
      expect(useAgentGroupStore.getState().groups.map((group) => group.id)).toEqual(['cached']),
    );
    expect(useAgentGroupStore.getState().groupsInit).toBe(true);
  });

  // The network request must not wait behind the hydration read: `sendAsGroup`
  // awaits `loadGroups()` before it navigates, so serializing the two delays both.
  it('starts the list request before the hydration read resolves', async () => {
    const scope = createScope();
    await agentGroupListResource.storage!.set(
      { queryKey: LIST_STORAGE_KEY, scope },
      { data: [groupRow('cached')], updatedAt: 1 },
    );
    getGroups.mockResolvedValue([groupRow('g1')]);

    // Hold the hydration read open so the request's start can be observed.
    const storage = agentGroupListResource.storage!;
    const original = storage.get.bind(storage);
    let releaseHydration!: () => void;
    const gate = new Promise<void>((resolve) => (releaseHydration = resolve));
    const getSpy = vi.spyOn(storage, 'get').mockImplementation(async (key: any) => {
      await gate;
      return original(key);
    });

    const inflight = useAgentGroupStore.getState().loadGroups();

    // The request is already in flight while hydration is still pending.
    await vi.waitFor(() => expect(getGroups).toHaveBeenCalled());
    expect(useAgentGroupStore.getState().groupsInit).toBe(false);

    releaseHydration();
    await inflight;
    expect(useAgentGroupStore.getState().groups.map((group) => group.id)).toEqual(['g1']);
    getSpy.mockRestore();
  });

  it('replaces the list with the server response, persists it and seeds groupMap', async () => {
    const scope = createScope();
    getGroups.mockResolvedValue([groupRow('g1', 'Server group')]);

    await useAgentGroupStore.getState().loadGroups();

    expect(useAgentGroupStore.getState().groups.map((group) => group.id)).toEqual(['g1']);
    expect(useAgentGroupStore.getState().groupsInit).toBe(true);
    // The list row also makes the group resolvable before its detail page mounts.
    expect(useAgentGroupStore.getState().groupMap.g1?.title).toBe('Server group');

    await vi.waitFor(async () =>
      expect(
        (
          await agentGroupListResource.storage!.get({ queryKey: LIST_STORAGE_KEY, scope })
        )?.data?.map((group) => group.id),
      ).toEqual(['g1']),
    );
  });

  it('never hydrates another identity’s persisted list', async () => {
    const scope = createScope();
    await agentGroupListResource.storage!.set(
      { queryKey: LIST_STORAGE_KEY, scope },
      { data: [groupRow('mine')], updatedAt: 1 },
    );
    createScope('agent-group-other-user');
    getGroups.mockImplementation(pending);

    void useAgentGroupStore.getState().loadGroups();

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(useAgentGroupStore.getState().groups).toEqual([]);
    expect(useAgentGroupStore.getState().groupsInit).toBe(false);
  });

  it('keeps a loaded roster and its authoritative config when the list is merged in', async () => {
    createScope();
    const detail = {
      ...groupDetail('g1', 'Loaded title'),
      agents: [{ id: 'a1', title: 'Member' }],
      config: { systemPrompt: 'authoritative' },
    };
    useAgentGroupStore.setState({
      agentGroupDetailReplica: createReplicaState(),
      groupMap: { g1: detail as any },
    });

    useAgentGroupStore
      .getState()
      .internal_updateGroupMaps([{ ...groupRow('g1', 'List title'), config: null } as any]);

    const merged = useAgentGroupStore.getState().groupMap.g1;
    expect(merged.title).toBe('List title');
    // The roster is detail-only data the list row cannot carry.
    expect(merged.agents).toEqual([{ id: 'a1', title: 'Member' }]);
    expect(merged.config).toEqual({ systemPrompt: 'authoritative' });
  });

  it('persists a fetched group detail so the group page paints it on the next visit', async () => {
    const scope = createScope();
    getGroupDetail.mockResolvedValue(groupDetail('g1', 'Server detail'));

    await useAgentGroupStore.getState().internal_fetchGroupDetail('g1');

    expect(useAgentGroupStore.getState().groupMap.g1?.title).toBe('Server detail');
    await vi.waitFor(async () =>
      expect(
        (
          await agentGroupDetailResource.storage!.get({
            queryKey: detailStorageKey('g1'),
            scope,
          })
        )?.data?.title,
      ).toBe('Server detail'),
    );

    // A fresh page load (memory gone, network slow) paints the persisted detail.
    useAgentGroupStore.setState({ ...initialChatGroupState });
    getGroupDetail.mockImplementation(pending);

    const session = renderHook(() => useAgentGroupStore.getState().useFetchGroupDetail(true, 'g1'));

    await vi.waitFor(() =>
      expect(useAgentGroupStore.getState().groupMap.g1?.title).toBe('Server detail'),
    );
    await vi.waitFor(() => expect(session.result.current.isHydrated).toBe(true));
    // Background loading must not hide the hydrated group.
    expect(session.result.current.isValidating).toBe(true);
    session.unmount();
  });

  it('drops a gone group from both views and storage, and marks it not found', async () => {
    const scope = createScope();
    getGroups.mockResolvedValue([groupRow('g1')]);
    getGroupDetail.mockResolvedValue(groupDetail('g1'));

    await useAgentGroupStore.getState().loadGroups();
    await useAgentGroupStore.getState().internal_fetchGroupDetail('g1');
    expect(useAgentGroupStore.getState().groupMap.g1).toBeDefined();
    await vi.waitFor(async () =>
      expect(
        (
          await agentGroupDetailResource.storage!.get({
            queryKey: detailStorageKey('g1'),
            scope,
          })
        )?.data,
      ).toBeDefined(),
    );

    getGroupDetail.mockResolvedValue(null);
    await useAgentGroupStore.getState().internal_fetchGroupDetail('g1');

    expect(useAgentGroupStore.getState().groupMap.g1).toBeUndefined();
    expect(useAgentGroupStore.getState().groups.some((group) => group.id === 'g1')).toBe(false);
    expect(useAgentGroupStore.getState().groupNotFoundMap.g1).toBe(true);

    await vi.waitFor(async () =>
      expect(
        await agentGroupDetailResource.storage!.get({ queryKey: detailStorageKey('g1'), scope }),
      ).toBeUndefined(),
    );
  });

  it('patches one group row in the list and the detail map in one fan-out', async () => {
    const scope = createScope();
    getGroups.mockResolvedValue([groupRow('g1', 'Before')]);
    getGroupDetail.mockResolvedValue(groupDetail('g1', 'Before'));

    await useAgentGroupStore.getState().loadGroups();
    await useAgentGroupStore.getState().internal_fetchGroupDetail('g1');

    useAgentGroupStore.getState().internal_updateGroupRow('g1', { title: 'After' });

    expect(useAgentGroupStore.getState().groupMap.g1?.title).toBe('After');
    expect(useAgentGroupStore.getState().groups[0].title).toBe('After');
    // The detail's roster survives a metadata-only patch.
    expect(useAgentGroupStore.getState().groupMap.g1?.agents).toEqual([]);

    await vi.waitFor(async () =>
      expect(
        (
          await agentGroupDetailResource.storage!.get({
            queryKey: detailStorageKey('g1'),
            scope,
          })
        )?.data?.title,
      ).toBe('After'),
    );
  });

  // P1 #1: the list seeds `groupMap` with a roster-less row. That seed must not
  // block the persisted full detail from hydrating, or a slow / failed / offline
  // detail fetch strands the group page on default config and no members.
  it('hydrates the persisted detail over a list seed when the network never answers', async () => {
    const scope = createScope();
    const roster = [{ id: 'a1', isSupervisor: false, title: 'Member' }];
    await agentGroupDetailResource.storage!.set(
      { queryKey: detailStorageKey('g1'), scope },
      {
        data: {
          ...groupDetail('g1', 'Persisted detail'),
          agents: roster,
          config: { systemPrompt: 'authoritative' },
        } as any,
        updatedAt: 1,
      },
    );

    // The list lands first: `groupMap` only knows the roster-less list row.
    useAgentGroupStore
      .getState()
      .internal_updateGroupMaps([{ ...groupRow('g1', 'List row'), config: null } as any]);
    expect(useAgentGroupStore.getState().groupMap.g1?.title).toBe('List row');
    expect(useAgentGroupStore.getState().groupMap.g1?.agents).toEqual([]);

    // The group page mounts while the network hangs (offline / slow).
    getGroupDetail.mockImplementation(pending);
    const session = renderHook(() => useAgentGroupStore.getState().useFetchGroupDetail(true, 'g1'));

    await vi.waitFor(() =>
      expect(useAgentGroupStore.getState().groupMap.g1?.agents).toEqual(roster),
    );
    expect(useAgentGroupStore.getState().groupMap.g1?.config).toEqual({
      systemPrompt: 'authoritative',
    });
    session.unmount();
  });

  it('never persists a list seed over the authoritative detail row', async () => {
    const scope = createScope();
    await agentGroupDetailResource.storage!.set(
      { queryKey: detailStorageKey('g1'), scope },
      {
        data: {
          ...groupDetail('g1', 'Persisted detail'),
          agents: [{ id: 'a1', isSupervisor: false, title: 'Member' }],
        } as any,
        updatedAt: 1,
      },
    );

    // Only the list seed is in memory (the detail was not loaded this session).
    useAgentGroupStore
      .getState()
      .internal_updateGroupMaps([{ ...groupRow('g1', 'List row'), config: null } as any]);
    expect(useAgentGroupStore.getState().groupMap.g1?.agents).toEqual([]);

    // A metadata patch against the seed asks to persist, but a seed never does.
    useAgentGroupStore.getState().internal_updateGroupRow('g1', { title: 'Renamed' });
    expect(useAgentGroupStore.getState().groupMap.g1?.title).toBe('Renamed');

    await new Promise((resolve) => setTimeout(resolve, 30));
    const row = await agentGroupDetailResource.storage!.get({
      queryKey: detailStorageKey('g1'),
      scope,
    });
    expect(row?.data?.title).toBe('Persisted detail');
    expect((row?.data as any)?.agents).toEqual([
      { id: 'a1', isSupervisor: false, title: 'Member' },
    ]);
  });

  // P1 #2: two users in personal mode both have a `null` workspace, so the guard
  // must compare the full cache scope (`${userId}:${workspaceId}`) — otherwise a
  // response started for user A lands in user B's partition.
  it('drops a group detail response that lands after an account switch', async () => {
    createScope('agent-group-user-a');
    let resolveDetail!: (value: unknown) => void;
    getGroupDetail.mockImplementation(() => new Promise((resolve) => (resolveDetail = resolve)));

    const inflight = useAgentGroupStore.getState().internal_fetchGroupDetail('g1');
    // Switch to another user, also personal (both have a null workspace).
    const scopeB = createScope('agent-group-user-b');

    resolveDetail(groupDetail('g1', 'User A group'));
    await inflight;

    expect(useAgentGroupStore.getState().groupMap.g1).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(
      await agentGroupDetailResource.storage!.get({
        queryKey: detailStorageKey('g1'),
        scope: scopeB,
      }),
    ).toBeUndefined();
  });

  it('drops a group list response that lands after an account switch', async () => {
    createScope('agent-group-user-a');
    let resolveGroups!: (value: unknown) => void;
    getGroups.mockImplementation(() => new Promise((resolve) => (resolveGroups = resolve)));

    const inflight = useAgentGroupStore.getState().loadGroups();
    // `loadGroups` hydrates before it fetches, so wait for the request to be in flight.
    await vi.waitFor(() => expect(getGroups).toHaveBeenCalled());
    const scopeB = createScope('agent-group-user-b');

    resolveGroups([groupRow('g1', 'User A group')]);
    await inflight;

    expect(useAgentGroupStore.getState().groups).toEqual([]);
    expect(useAgentGroupStore.getState().groupMap.g1).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(
      await agentGroupListResource.storage!.get({ queryKey: LIST_STORAGE_KEY, scope: scopeB }),
    ).toBeUndefined();
  });

  // P1: the group list is the authoritative, complete set. A group it no longer
  // returns was deleted or is no longer visible, so its detail must be dropped
  // from `groupMap` (and the persisted replica) — otherwise selectors such as
  // the supervisor fallback keep resolving a group the server does not list.
  it('prunes a detail the authoritative list no longer carries, from memory and storage', async () => {
    const scope = createScope();
    getGroups.mockResolvedValue([groupRow('g1'), groupRow('g2')]);
    getGroupDetail.mockImplementation(async (groupId: string) => groupDetail(groupId));

    await useAgentGroupStore.getState().loadGroups();
    await useAgentGroupStore.getState().internal_fetchGroupDetail('g1');
    await useAgentGroupStore.getState().internal_fetchGroupDetail('g2');
    expect(useAgentGroupStore.getState().groupMap.g2).toBeDefined();
    await vi.waitFor(async () =>
      expect(
        (await agentGroupDetailResource.storage!.get({ queryKey: detailStorageKey('g2'), scope }))
          ?.data,
      ).toBeDefined(),
    );

    // `g2` is gone from the next authoritative list.
    getGroups.mockResolvedValue([groupRow('g1')]);
    await useAgentGroupStore.getState().loadGroups();

    expect(useAgentGroupStore.getState().groups.map((group) => group.id)).toEqual(['g1']);
    expect(useAgentGroupStore.getState().groupMap.g2).toBeUndefined();
    // The group that is still listed keeps its detail.
    expect(useAgentGroupStore.getState().groupMap.g1).toBeDefined();
    await vi.waitFor(async () =>
      expect(
        await agentGroupDetailResource.storage!.get({ queryKey: detailStorageKey('g2'), scope }),
      ).toBeUndefined(),
    );
  });

  // P1: a group can live in the persisted list without ever being seeded into
  // `groupMap`. After a reload the list hydrates it, the authoritative response
  // drops it — and its persisted detail must go too, or a later direct visit
  // paints a deleted / unauthorized group from storage while the network is slow.
  it('prunes a persisted detail the authoritative list drops, with no groupMap entry', async () => {
    const scope = createScope();
    getGroups.mockResolvedValue([groupRow('g1'), groupRow('g2')]);
    getGroupDetail.mockImplementation(async (groupId: string) => groupDetail(groupId));

    // An earlier visit persisted both the list and g2's detail.
    await useAgentGroupStore.getState().loadGroups();
    await useAgentGroupStore.getState().internal_fetchGroupDetail('g2');
    await vi.waitFor(async () =>
      expect(
        (
          await agentGroupListResource.storage!.get({ queryKey: LIST_STORAGE_KEY, scope })
        )?.data?.map((group) => group.id),
      ).toEqual(['g1', 'g2']),
    );
    await vi.waitFor(async () =>
      expect(
        (await agentGroupDetailResource.storage!.get({ queryKey: detailStorageKey('g2'), scope }))
          ?.data,
      ).toBeDefined(),
    );

    // Reload: memory is gone, storage stays — `groupMap` is empty again, so the
    // list is the only thing that still knows about g2 before the network answers.
    useAgentGroupStore.setState({ ...initialChatGroupState });
    expect(useAgentGroupStore.getState().groupMap.g2).toBeUndefined();

    getGroups.mockResolvedValue([groupRow('g1')]);
    await useAgentGroupStore.getState().loadGroups();

    // g2 never entered `groupMap` this session, yet its persisted detail is gone.
    expect(useAgentGroupStore.getState().groupMap.g2).toBeUndefined();
    expect(useAgentGroupStore.getState().groups.map((group) => group.id)).toEqual(['g1']);
    await vi.waitFor(async () =>
      expect(
        await agentGroupDetailResource.storage!.get({ queryKey: detailStorageKey('g2'), scope }),
      ).toBeUndefined(),
    );
  });

  // P1: a persisted detail hydrates with no network response. Its success side
  // effects must run off the hydrated value too, or an offline / slow first
  // paint resolves tools / models through an empty (or previously active) agent
  // and stays behind the 404 guard.
  it('replays the group-detail side effects for a hydrated value', async () => {
    const scope = createScope();
    const roster = [
      { id: 'a1', isSupervisor: false, title: 'Member', updatedAt: new Date('2030-01-01') },
    ];
    await agentGroupDetailResource.storage!.set(
      { queryKey: detailStorageKey('g1'), scope },
      {
        data: {
          ...groupDetail('g1', 'Persisted detail'),
          agents: roster,
          supervisorAgentId: 'sup-1',
        } as any,
        updatedAt: 1,
      },
    );

    // A stale not-found flag left by an earlier (failed) visit.
    useAgentGroupStore.setState({ groupNotFoundMap: { g1: true } });

    getGroupDetail.mockImplementation(pending);
    const session = renderHook(() => useAgentGroupStore.getState().useFetchGroupDetail(true, 'g1'));

    await vi.waitFor(() =>
      expect(useAgentGroupStore.getState().groupMap.g1?.title).toBe('Persisted detail'),
    );
    // … roster copied into the agent store …
    await vi.waitFor(() =>
      expect(agentStoreMock.internal_dispatchAgentMap).toHaveBeenCalledWith(
        'a1',
        expect.objectContaining({ id: 'a1' }),
      ),
    );
    // … supervisor adopted as the active agent …
    expect(agentStoreMock.setActiveAgentId).toHaveBeenCalledWith('sup-1');
    // … and the stale 404 cleared, all with no network response.
    expect(useAgentGroupStore.getState().groupNotFoundMap.g1).toBeUndefined();

    await vi.waitFor(() => expect(session.result.current.isHydrated).toBe(true));
    session.unmount();
  });

  // P1: the generic `useSync` hook must not replay a response's success side
  // effects when the scoped write was rejected. A detail fetch started under
  // user A that resolves after the switch to user B must not copy A's roster
  // into the current agent store nor adopt A's supervisor as the active agent.
  it('does not adopt a detail response that lands after an account switch', async () => {
    createScope('agent-group-user-a');
    let resolveDetail!: (value: unknown) => void;
    getGroupDetail.mockImplementation(() => new Promise((resolve) => (resolveDetail = resolve)));

    const session = renderHook(() => useAgentGroupStore.getState().useFetchGroupDetail(true, 'g1'));
    await vi.waitFor(() => expect(getGroupDetail).toHaveBeenCalled());

    // The identity switches while the request is still in flight.
    createScope('agent-group-user-b');
    resolveDetail({
      ...groupDetail('g1', 'User A group'),
      agents: [{ id: 'a1', isSupervisor: false, title: 'A member' }],
      supervisorAgentId: 'a-supervisor',
    });

    await vi.waitFor(() => expect(session.result.current.isHydrated).toBe(true));
    expect(useAgentGroupStore.getState().groupMap.g1).toBeUndefined();
    expect(agentStoreMock.internal_dispatchAgentMap).not.toHaveBeenCalled();
    expect(agentStoreMock.setActiveAgentId).not.toHaveBeenCalled();
    session.unmount();
  });

  // P2: a list / session refresh seeds every group at once. One batched replica
  // write means one store commit (one subscriber notification), not one per row.
  it('seeds many groups in a single store commit', () => {
    createScope();
    let notifications = 0;
    const unsubscribe = useAgentGroupStore.subscribe(() => {
      notifications += 1;
    });

    useAgentGroupStore
      .getState()
      .internal_updateGroupMaps([
        { ...groupRow('g1', 'One'), config: null } as any,
        { ...groupRow('g2', 'Two'), config: null } as any,
        { ...groupRow('g3', 'Three'), config: null } as any,
      ]);
    unsubscribe();

    expect(notifications).toBe(1);
    expect(Object.keys(useAgentGroupStore.getState().groupMap).sort()).toEqual(['g1', 'g2', 'g3']);
    expect(useAgentGroupStore.getState().groupMap.g2?.title).toBe('Two');
  });

  // P1: a server-confirmed absence (deleted / no access) must win over a detail
  // hydrate that was already reading storage. Otherwise the stale read restores
  // the group, `onHydrated` clears the 404 and adopts the old roster, and the
  // gone group stays on screen with no further network call to correct it.
  it('does not resurrect a group the server confirmed gone while its hydrate was in flight', async () => {
    const scope = createScope();
    await agentGroupDetailResource.storage!.set(
      { queryKey: detailStorageKey('g1'), scope },
      { data: groupDetail('g1', 'Persisted detail'), updatedAt: 1 },
    );
    // The list already seeded the group, so the page has something to hydrate.
    useAgentGroupStore.getState().internal_updateGroupMaps([groupRow('g1', 'List row')]);

    // Park the detail hydrate: read the row now (a storage snapshot), resolve late.
    const storage = agentGroupDetailResource.storage!;
    const realGet = storage.get.bind(storage);
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => (releaseRead = resolve));
    let readStarted = false;
    vi.spyOn(storage, 'get').mockImplementation(async (key) => {
      if (key.queryKey === detailStorageKey('g1') && key.scope === scope) {
        const snapshot = await realGet(key);
        readStarted = true;
        await readGate;
        return snapshot;
      }
      return realGet(key);
    });

    // The server answers first: the group is gone.
    getGroupDetail.mockResolvedValue(null);
    const session = renderHook(() => useAgentGroupStore.getState().useFetchGroupDetail(true, 'g1'));

    await vi.waitFor(() => expect(readStarted).toBe(true));
    await vi.waitFor(() => expect(useAgentGroupStore.getState().groupNotFoundMap.g1).toBe(true));
    expect(useAgentGroupStore.getState().groupMap.g1).toBeUndefined();

    // The stale read finally lands; the group must stay gone.
    releaseRead();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(useAgentGroupStore.getState().groupMap.g1).toBeUndefined();
    expect(useAgentGroupStore.getState().groupNotFoundMap.g1).toBe(true);
    expect(agentStoreMock.setActiveAgentId).not.toHaveBeenCalled();
    session.unmount();
  });

  // P1: switching to another group while `g1`'s storage read is slow must not let
  // `g1`'s hydrate replay its side effects. Filling g1's cache entry is harmless,
  // but `onHydrated` acts on the current view and would reset the active agent and
  // chat model back to g1's supervisor.
  it('does not adopt a superseded group when its hydrate lands after navigation', async () => {
    const scope = createScope();
    await agentGroupDetailResource.storage!.set(
      { queryKey: detailStorageKey('g1'), scope },
      { data: groupDetail('g1', 'One'), updatedAt: 1 },
    );
    await agentGroupDetailResource.storage!.set(
      { queryKey: detailStorageKey('g2'), scope },
      { data: groupDetail('g2', 'Two'), updatedAt: 1 },
    );

    const storage = agentGroupDetailResource.storage!;
    const realGet = storage.get.bind(storage);
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => (releaseRead = resolve));
    let readStarted = false;
    vi.spyOn(storage, 'get').mockImplementation(async (key) => {
      if (key.queryKey === detailStorageKey('g1') && key.scope === scope) {
        const snapshot = await realGet(key);
        readStarted = true;
        await readGate;
        return snapshot;
      }
      return realGet(key);
    });

    getGroupDetail.mockImplementation(pending);

    const session = renderHook(
      ({ id }: { id: string }) => useAgentGroupStore.getState().useFetchGroupDetail(true, id),
      { initialProps: { id: 'g1' } },
    );
    await vi.waitFor(() => expect(readStarted).toBe(true));

    // Navigate to g2 while g1's hydrate is still parked.
    session.rerender({ id: 'g2' });
    await vi.waitFor(() =>
      expect(agentStoreMock.setActiveAgentId).toHaveBeenCalledWith('g2-supervisor'),
    );

    // g1's slow hydrate lands now — it must not re-adopt g1's supervisor.
    releaseRead();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(agentStoreMock.setActiveAgentId).not.toHaveBeenCalledWith('g1-supervisor');
    expect(agentStoreMock.setActiveAgentId).toHaveBeenLastCalledWith('g2-supervisor');
    session.unmount();
  });

  // P1: g1 → g2 → g1 offline. g1's hydration already ran and is not re-run, so
  // its side effects must be replayed off the cached detail when g1 is active
  // again — otherwise the agent / chat stores stay on g2's supervisor.
  it('re-adopts a cached group when navigating back to it with no network', async () => {
    const scope = createScope();
    await agentGroupDetailResource.storage!.set(
      { queryKey: detailStorageKey('g1'), scope },
      { data: groupDetail('g1', 'One'), updatedAt: 1 },
    );
    await agentGroupDetailResource.storage!.set(
      { queryKey: detailStorageKey('g2'), scope },
      { data: groupDetail('g2', 'Two'), updatedAt: 1 },
    );
    getGroupDetail.mockImplementation(pending);

    const session = renderHook(
      ({ id }: { id: string }) => useAgentGroupStore.getState().useFetchGroupDetail(true, id),
      { initialProps: { id: 'g1' } },
    );
    await vi.waitFor(() =>
      expect(agentStoreMock.setActiveAgentId).toHaveBeenLastCalledWith('g1-supervisor'),
    );

    session.rerender({ id: 'g2' });
    await vi.waitFor(() =>
      expect(agentStoreMock.setActiveAgentId).toHaveBeenLastCalledWith('g2-supervisor'),
    );

    session.rerender({ id: 'g1' });
    await vi.waitFor(() =>
      expect(agentStoreMock.setActiveAgentId).toHaveBeenLastCalledWith('g1-supervisor'),
    );
    session.unmount();
  });

  // P2: a rename confirmed by the API while the detail is still a list seed
  // (its storage read not landed yet) must survive the late hydrate, and the
  // hydrated detail must persist with the rename and keep its stored roster.
  it('keeps a confirmed rename made over a seed when the detail hydrates late', async () => {
    const scope = createScope();
    const roster = [{ id: 'a1', isSupervisor: false, title: 'Member' }];
    await agentGroupDetailResource.storage!.set(
      { queryKey: detailStorageKey('g1'), scope },
      { data: { ...groupDetail('g1', 'Persisted detail'), agents: roster } as any, updatedAt: 1 },
    );

    const storage = agentGroupDetailResource.storage!;
    const realGet = storage.get.bind(storage);
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => (releaseRead = resolve));
    let readStarted = false;
    vi.spyOn(storage, 'get').mockImplementation(async (key) => {
      if (key.queryKey === detailStorageKey('g1') && key.scope === scope) {
        const snapshot = await realGet(key);
        readStarted = true;
        await readGate;
        return snapshot;
      }
      return realGet(key);
    });

    useAgentGroupStore
      .getState()
      .internal_updateGroupMaps([{ ...groupRow('g1', 'List row'), config: null } as any]);
    getGroupDetail.mockImplementation(pending);
    const session = renderHook(() => useAgentGroupStore.getState().useFetchGroupDetail(true, 'g1'));
    await vi.waitFor(() => expect(readStarted).toBe(true));

    // The API confirmed the rename; the detail is still the list seed.
    useAgentGroupStore.getState().internal_updateGroupRow('g1', { title: 'Renamed' });
    expect(useAgentGroupStore.getState().groupMap.g1?.title).toBe('Renamed');

    releaseRead();
    await vi.waitFor(() =>
      expect(useAgentGroupStore.getState().groupMap.g1?.agents).toEqual(roster),
    );
    expect(useAgentGroupStore.getState().groupMap.g1?.title).toBe('Renamed');
    await vi.waitFor(async () =>
      expect((await realGet({ queryKey: detailStorageKey('g1'), scope }))?.data).toMatchObject({
        agents: roster,
        title: 'Renamed',
      }),
    );
    session.unmount();
  });

  // P1: after a workspace switch the store stays mounted with `groupsInit` still
  // true. `loadGroups` must reset the view to the new scope and read its persisted
  // list rather than leaving the previous workspace's groups on screen until the
  // (possibly slow) response lands.
  it('resets to the new scope and hydrates its list when the workspace switches', async () => {
    createScope('agent-group-user-a');
    getGroups.mockResolvedValue([groupRow('g1', 'A group')]);
    await useAgentGroupStore.getState().loadGroups();
    expect(useAgentGroupStore.getState().groupsInit).toBe(true);
    expect(useAgentGroupStore.getState().groups.map((group) => group.id)).toEqual(['g1']);

    // The new scope persists a list of its own.
    const scopeB = createScope('agent-group-user-b');
    await agentGroupListResource.storage!.set(
      { queryKey: LIST_STORAGE_KEY, scope: scopeB },
      { data: [groupRow('b1', 'B group')], updatedAt: 1 },
    );

    // The network is slow, so the new scope's persisted list must paint meanwhile.
    let resolveGroups!: (value: unknown) => void;
    getGroups.mockImplementation(() => new Promise((resolve) => (resolveGroups = resolve)));

    const inflight = useAgentGroupStore.getState().loadGroups();

    await vi.waitFor(() =>
      expect(useAgentGroupStore.getState().groups.map((group) => group.id)).toEqual(['b1']),
    );

    resolveGroups([groupRow('b1', 'B group')]);
    await inflight;
    expect(useAgentGroupStore.getState().groups.map((group) => group.id)).toEqual(['b1']);
  });
});
