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

vi.mock('@/store/agent', () => ({
  getAgentStoreState: vi.fn(() => ({
    agentMap: {},
    internal_dispatchAgentMap: vi.fn(),
    setActiveAgentId: vi.fn(),
  })),
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
    useAgentGroupStore.setState({ ...initialChatGroupState });
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((scope) => [
        agentGroupListResource.storage!.remove({ queryKey: LIST_STORAGE_KEY, scope }),
        agentGroupDetailResource.storage!.remove({ queryKey: detailStorageKey('g1'), scope }),
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
});
