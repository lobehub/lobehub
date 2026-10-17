import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DisplayPreferenceMemory } from '@/database/repositories/userMemory';
import { cacheScope } from '@/libs/replica';
import type * as SwrLib from '@/libs/swr';
import { mutate } from '@/libs/swr';
import { userMemoryKeys } from '@/libs/swr/keys';
import { memoryCRUDService } from '@/services/userMemory';
import { useUserMemoryStore } from '@/store/userMemory';
import { initialState } from '@/store/userMemory/initialState';
import { LayersEnum } from '@/types/userMemory';

vi.mock('@/libs/swr', async (importOriginal) => {
  const actual = await importOriginal<typeof SwrLib>();

  return {
    ...actual,
    mutate: vi.fn().mockResolvedValue(undefined),
  };
});

const preferenceMemory = {
  accessedAt: new Date('2026-05-27T00:00:00.000Z'),
  capturedAt: new Date('2026-05-27T00:00:00.000Z'),
  conclusionDirectives: 'Prefer concise answers.',
  createdAt: new Date('2026-05-27T00:00:00.000Z'),
  id: 'preference-1',
  metadata: null,
  scorePriority: 0,
  suggestions: null,
  tags: [],
  title: 'Preference',
  type: null,
  updatedAt: new Date('2026-05-27T00:00:00.000Z'),
  userId: 'user-1',
  userMemoryId: 'memory-1',
} satisfies DisplayPreferenceMemory;

beforeEach(() => {
  vi.clearAllMocks();

  const page = {
    currentPage: 0,
    hasMore: false,
    items: [preferenceMemory],
    pageSize: 12,
    total: 1,
  };
  useUserMemoryStore.setState(
    {
      ...initialState,
      preferenceListData: page,
      preferenceListEntries: { [initialState.preferenceListKey]: page },
      preferences: [preferenceMemory],
      preferencesInit: true,
      preferencesPage: 1,
      preferencesTotal: 1,
    },
    false,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('userMemory base actions', () => {
  describe('updateMemory', () => {
    it.each([
      [LayersEnum.Activity, 'updateActivity', 'internal_updateActivityEntity', 'narrative'],
      [LayersEnum.Context, 'updateContext', 'internal_updateContextEntity', 'description'],
      [LayersEnum.Experience, 'updateExperience', 'internal_updateExperienceEntity', 'keyLearning'],
      [LayersEnum.Identity, 'updateIdentity', 'internal_updateIdentityEntity', 'description'],
      [
        LayersEnum.Preference,
        'updatePreference',
        'internal_updatePreferenceEntity',
        'conclusionDirectives',
      ],
    ] as const)(
      'routes a %s edit through its replica entity patch, then revalidates list and detail',
      async (layer, serviceMethod, entityAction, field) => {
        vi.spyOn(memoryCRUDService, serviceMethod).mockResolvedValue(true as never);
        const patchEntity = vi.fn();
        const refreshIdentities = vi.fn().mockResolvedValue(undefined);
        useUserMemoryStore.setState({
          [entityAction]: patchEntity,
          editingMemoryId: 'memory-1',
          refreshIdentities,
        });

        await useUserMemoryStore.getState().updateMemory('memory-1', 'edited', layer);

        expect(memoryCRUDService[serviceMethod]).toHaveBeenCalledWith('memory-1', {
          [field]: 'edited',
        });
        expect(patchEntity).toHaveBeenCalledTimes(1);
        const [id, patch] = patchEntity.mock.calls[0];
        expect(id).toBe('memory-1');
        expect(patch({ id: 'memory-1', [field]: 'old' })).toEqual({
          id: 'memory-1',
          [field]: 'edited',
        });
        expect(useUserMemoryStore.getState().editingMemoryId).toBeUndefined();
        expect(mutate).toHaveBeenCalledWith(userMemoryKeys.memoryDetail(layer, 'memory-1'));
        if (layer === LayersEnum.Identity) expect(refreshIdentities).toHaveBeenCalledTimes(1);
        else expect(mutate).toHaveBeenCalledWith(expect.any(Function));
      },
    );

    it('updates a preference memory in place and revalidates related caches', async () => {
      const updatePreferenceResult = {} as Awaited<
        ReturnType<typeof memoryCRUDService.updatePreference>
      >;
      vi.spyOn(memoryCRUDService, 'updatePreference').mockResolvedValue(updatePreferenceResult);

      const { result } = renderHook(() => useUserMemoryStore());

      await act(async () => {
        await result.current.updateMemory(
          'preference-1',
          'Prefer concise answers with examples.',
          LayersEnum.Preference,
        );
      });

      const edited = {
        ...preferenceMemory,
        conclusionDirectives: 'Prefer concise answers with examples.',
      };
      expect(result.current.preferences).toEqual([edited]);
      // The canonical replica value carries the edit, not only the flat mirror.
      expect(result.current.preferenceListEntries[result.current.preferenceListKey].items).toEqual([
        edited,
      ]);
      expect(memoryCRUDService.updatePreference).toHaveBeenCalledWith('preference-1', {
        conclusionDirectives: 'Prefer concise answers with examples.',
      });
      expect(mutate).toHaveBeenCalledWith(expect.any(Function));
      expect(mutate).toHaveBeenCalledWith(
        userMemoryKeys.memoryDetail(LayersEnum.Preference, 'preference-1'),
      );
    });

    it('applies an identity edit through the replica and revalidates it', async () => {
      vi.spyOn(memoryCRUDService, 'updateIdentity').mockResolvedValue(true);
      const internal_updateIdentityEntity = vi.fn();
      const internal_clearIdentityList = vi.fn().mockResolvedValue(true);
      const refreshIdentities = vi.fn().mockResolvedValue(undefined);
      useUserMemoryStore.setState({
        internal_clearIdentityList,
        internal_updateIdentityEntity,
        refreshIdentities,
      });

      await act(async () => {
        await useUserMemoryStore
          .getState()
          .updateMemory('identity-1', 'New description', LayersEnum.Identity);
      });

      expect(internal_updateIdentityEntity).toHaveBeenCalledWith(
        'identity-1',
        expect.any(Function),
      );
      const patch = internal_updateIdentityEntity.mock.calls[0][1];
      expect(patch({ description: 'old', id: 'identity-1' })).toEqual({
        description: 'New description',
        id: 'identity-1',
      });
      expect(refreshIdentities).toHaveBeenCalledTimes(1);
      expect(internal_clearIdentityList).not.toHaveBeenCalled();
    });
  });
});

/** Every replica-backed slice's purge action (see `purgeAllMemories`). */
const REPLICA_CLEARS = [
  'internal_clearMemoryReplicas',
  'internal_clearTopicMemories',
  'internal_clearHomeReplicas',
  'internal_clearActivityList',
  'internal_clearContextList',
  'internal_clearExperienceList',
  'internal_clearIdentityList',
  'internal_clearPreferenceList',
] as const;

/** Replace every slice purge with a spy that records its call and resolves `result`. */
const stubReplicaClears = (order: string[], results: Partial<Record<string, boolean>> = {}) => {
  const spies = Object.fromEntries(
    REPLICA_CLEARS.map((name) => [
      name,
      vi.fn(async () => {
        order.push(name);
        return results[name] ?? true;
      }),
    ]),
  );
  useUserMemoryStore.setState(spies);
  return spies;
};

describe('purgeAllMemories', () => {
  const useCacheScope = (value: string) => {
    vi.spyOn(cacheScope, 'get').mockReturnValue(value);
  };

  beforeEach(() => {
    useCacheScope('user-1:personal');
  });

  it('clears every replica right after deleting, then revalidates', async () => {
    const order: string[] = [];
    vi.spyOn(memoryCRUDService, 'deleteAll').mockImplementation(async () => {
      order.push('deleteAll');
      return undefined as never;
    });
    stubReplicaClears(order);
    vi.mocked(mutate).mockImplementation(async () => {
      order.push('revalidate');
    });

    await useUserMemoryStore.getState().purgeAllMemories();

    // Every slice purge runs right after the server delete, before any refetch.
    expect(order.slice(0, REPLICA_CLEARS.length + 1)).toEqual(['deleteAll', ...REPLICA_CLEARS]);
    expect(order.slice(REPLICA_CLEARS.length + 1).every((step) => step === 'revalidate')).toBe(
      true,
    );
    // The replica-owned fields are not overwritten by `preferenceInitialState`.
    expect(useUserMemoryStore.getState().preferences).toEqual([preferenceMemory]);
  });

  it('surfaces a local purge failure after the in-memory reset and the refetch', async () => {
    const order: string[] = [];
    vi.spyOn(memoryCRUDService, 'deleteAll').mockResolvedValue(undefined as never);
    const spies = stubReplicaClears(order, { internal_clearContextList: false });
    useUserMemoryStore.setState({ editingMemoryId: 'editing' });
    vi.mocked(mutate).mockImplementation(async () => {
      order.push('revalidate');
    });

    await expect(useUserMemoryStore.getState().purgeAllMemories()).rejects.toThrow(
      'Failed to purge persisted memories from local storage',
    );

    // A failed slice does not stop the others, and the reset + refetch still ran.
    for (const name of REPLICA_CLEARS) expect(spies[name]).toHaveBeenCalledTimes(1);
    expect(useUserMemoryStore.getState().editingMemoryId).toBeUndefined();
    expect(order).toContain('revalidate');
  });

  it('purges the same user’s replicas when the workspace switches mid-purge', async () => {
    const order: string[] = [];
    vi.spyOn(memoryCRUDService, 'deleteAll').mockImplementation(async () => {
      // Memories are per user: another workspace of the same user is the same partition.
      useCacheScope('user-1:ws-2');
      return undefined as never;
    });
    const spies = stubReplicaClears(order);

    await useUserMemoryStore.getState().purgeAllMemories();

    // Same user: the ordinary (active-partition) purge.
    for (const name of REPLICA_CLEARS) expect(spies[name]).toHaveBeenCalledWith('user-1:*');
  });

  it('purges only the deleted user’s partition when the account switches mid-purge', async () => {
    const order: string[] = [];
    vi.spyOn(memoryCRUDService, 'deleteAll').mockImplementation(async () => {
      useCacheScope('user-2:personal');
      return undefined as never;
    });
    const spies = stubReplicaClears(order);
    useUserMemoryStore.setState({ editingMemoryId: 'kept' });
    vi.mocked(mutate).mockClear();

    await expect(useUserMemoryStore.getState().purgeAllMemories()).resolves.toBeUndefined();

    // Every slice purges the user the server deleted, not the active one.
    for (const name of REPLICA_CLEARS) expect(spies[name]).toHaveBeenCalledWith('user-1:*');
    // The active user's state and mounted queries are left alone.
    expect(useUserMemoryStore.getState().editingMemoryId).toBe('kept');
    expect(useUserMemoryStore.getState().preferences).toEqual([preferenceMemory]);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('surfaces a failed purge of the deleted user’s partition after an account switch', async () => {
    vi.spyOn(memoryCRUDService, 'deleteAll').mockImplementation(async () => {
      useCacheScope('user-2:personal');
      return undefined as never;
    });
    stubReplicaClears([], { internal_clearTopicMemories: false });

    await expect(useUserMemoryStore.getState().purgeAllMemories()).rejects.toThrow(
      'Failed to purge persisted memories from local storage',
    );
  });
});

describe('deletePersona', () => {
  const persona = { content: 'My persona', summary: 'Summary' };

  beforeEach(() => {
    useUserMemoryStore.setState({ persona, personaData: { persona }, personaInit: true });
    vi.mocked(mutate).mockResolvedValue(undefined as never);
  });

  it('clears the persona replica view while retaining the memory lists', async () => {
    vi.spyOn(memoryCRUDService, 'deletePersona').mockResolvedValue({ success: true });
    await useUserMemoryStore.getState().deletePersona();
    expect(useUserMemoryStore.getState().persona).toBeUndefined();
    // The canonical replica view carries the server-confirmed absence.
    expect(useUserMemoryStore.getState().personaData).toEqual({ persona: null });
    expect(useUserMemoryStore.getState().personaInit).toBe(true);
    expect(useUserMemoryStore.getState().preferences).toEqual([preferenceMemory]);
    expect(useUserMemoryStore.getState().preferencesTotal).toBe(1);
    // The replica adopts the userMemory:persona key as its sync key.
    expect(mutate).toHaveBeenCalledWith(userMemoryKeys.persona());
  });

  it('resolves when the persona is deleted but the follow-up read fails', async () => {
    vi.spyOn(memoryCRUDService, 'deletePersona').mockResolvedValue({ success: true });
    vi.mocked(mutate).mockRejectedValueOnce(new Error('read failed'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(useUserMemoryStore.getState().deletePersona()).resolves.toBeUndefined();

    expect(useUserMemoryStore.getState().persona).toBeUndefined();
    expect(useUserMemoryStore.getState().personaData).toEqual({ persona: null });
    expect(consoleError).toHaveBeenCalled();
  });

  it('retains the persona and memories when deletion fails', async () => {
    vi.spyOn(memoryCRUDService, 'deletePersona').mockRejectedValue(new Error('offline'));
    await expect(useUserMemoryStore.getState().deletePersona()).rejects.toThrow('offline');
    expect(useUserMemoryStore.getState().persona).toEqual(persona);
    expect(useUserMemoryStore.getState().preferences).toEqual([preferenceMemory]);
  });
});
