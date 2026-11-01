import { produce } from 'immer';
import { type SWRResponse } from 'swr';

import { createReplicaSlice, type ReplicaLens, type ReplicaSyncResult } from '@/libs/replica';
import { mutate } from '@/libs/swr';
import { userMemoryKeys } from '@/libs/swr/keys';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { type RetrieveMemoryParams, type RetrieveMemoryResult } from '@/types/userMemory';
import { LayersEnum } from '@/types/userMemory';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore, useUserMemoryStore } from '../../store';
import { userMemoryCacheKey } from '../../utils/cacheKey';
import { clearUserReplicas, userMemoryIdentityScope } from '../../utils/replica';
import { createMemorySearchParams } from '../../utils/searchParams';
import {
  type MemoryDetailDisplay,
  memoryDetailKey,
  type MemoryDetailParams,
  userMemoryDetailResource,
  userMemoryRetrieveResource,
} from './projection';

const n = setNamespace('userMemory');

type MemoryContext = Parameters<typeof createMemorySearchParams>[0];

/**
 * The retrieve result map keeps its long-standing flat field (`memoryMap`) as the
 * replica view, plus the per-entry fetched-at stamp the memory selectors read.
 * The engine owns every write; the selectors keep reading the same place.
 */
const retrieveMapLens: ReplicaLens<UserMemoryStore, RetrieveMemoryResult> = {
  clear: () => ({ memoryFetchedAtMap: {}, memoryMap: {} }),
  get: (state, key) => state.memoryMap[key],
  keys: (state) => Object.keys(state.memoryMap),
  set: (state, key, data) => {
    const memoryMap = { ...state.memoryMap };
    const memoryFetchedAtMap = { ...state.memoryFetchedAtMap };

    if (data === undefined) {
      delete memoryMap[key];
      delete memoryFetchedAtMap[key];
    } else {
      memoryMap[key] = data;
      memoryFetchedAtMap[key] = Date.now();
    }

    return { memoryFetchedAtMap, memoryMap };
  },
};

/**
 * One memory detail per `${layer}:${id}`, mirrored into `memoryDetailMap` so the
 * right-hand panels read the replica view instead of a raw SWR cache entry.
 */
const detailMapLens: ReplicaLens<UserMemoryStore, MemoryDetailDisplay> = {
  clear: () => ({ memoryDetailMap: {} }),
  get: (state, key) => state.memoryDetailMap[key],
  keys: (state) => Object.keys(state.memoryDetailMap),
  set: (state, key, data) => {
    const memoryDetailMap = { ...state.memoryDetailMap };

    if (data === undefined) delete memoryDetailMap[key];
    else memoryDetailMap[key] = data;

    return { memoryDetailMap };
  },
};

type Setter = StoreSetter<UserMemoryStore>;
export const createBaseSlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new BaseActionImpl(set, get, _api);

export class BaseActionImpl {
  readonly #detail;
  readonly #get: () => UserMemoryStore;
  readonly #retrieve;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#detail = createReplicaSlice(userMemoryDetailResource, {
      actionPrefix: n('memoryDetail'),
      fetcher: (params) => this.#fetchDetail(params),
      get,
      // A detail the server no longer has removes the cached one, so a memory
      // deleted elsewhere (or a stale detail URL) renders the not-found state.
      isMissing: (detail) => detail === null,
      set,
      stateKey: 'memoryDetailReplica',
      view: detailMapLens,
    });
    this.#retrieve = createReplicaSlice(userMemoryRetrieveResource, {
      actionPrefix: n('memoryRetrieve'),
      fetcher: (params) => userMemoryService.retrieveMemory(params),
      get,
      set,
      stateKey: 'memoryRetrieveReplica',
      view: retrieveMapLens,
    });
  }

  clearEditingMemory = (): void => {
    this.#set(
      {
        editingMemoryContent: undefined,
        editingMemoryId: undefined,
        editingMemoryLayer: undefined,
      },
      false,
      n('clearEditingMemory'),
    );
  };

  /** PersonaHeader confirmation deletes the persona through memoryCRUDService, then refreshes its replica. */
  deletePersona = async (): Promise<void> => {
    const { memoryCRUDService } = await import('@/services/userMemory');
    // The account whose persona is deleted (see `refreshPersona`).
    const user = userMemoryIdentityScope.get();
    await memoryCRUDService.deletePersona();
    // The persona is a replica view now: drop it locally and re-read server
    // truth (null) so the section disappears without waiting for the network.
    await this.#get().refreshPersona(user);
  };

  /**
   * Flatten the nested detail response into the shape the right-hand panel
   * reads. `null` means "no such memory": it removes the cached detail
   * (`isMissing`), and the panel renders as empty.
   */
  #fetchDetail = async ({ id, layer }: MemoryDetailParams): Promise<MemoryDetailDisplay | null> => {
    const detail = await userMemoryService.getMemoryDetail({ id, layer });
    if (!detail || detail.layer !== layer) return null;

    const source = { source: detail.source, sourceType: detail.sourceType };

    switch (detail.layer) {
      case LayersEnum.Activity: {
        return { ...detail.memory, ...detail.activity, ...source };
      }
      case LayersEnum.Context: {
        return { ...detail.memory, ...detail.context, ...source };
      }
      case LayersEnum.Experience: {
        return { ...detail.memory, ...detail.experience, ...source };
      }
      case LayersEnum.Identity: {
        return { ...detail.memory, ...detail.identity, ...source };
      }
      case LayersEnum.Preference: {
        return { ...detail.memory, ...detail.preference, ...source };
      }
      default: {
        return null;
      }
    }
  };

  /**
   * Drop the retrieve map and every memory detail through their replicas:
   * memory, every persisted row of the active scope (including query variants
   * not loaded in memory) and reads in flight. Called by `purgeAllMemories`
   * before it revalidates. A storage failure leaves a row the next session has
   * no record of, so the purge is retried once; resolves `true` once storage
   * is purged.
   */
  internal_clearMemoryReplicas = (user?: string): Promise<boolean> =>
    clearUserReplicas(user, this.#retrieve, this.#detail);

  purgeAllMemories = async (): Promise<void> => {
    const { memoryCRUDService } = await import('@/services/userMemory');

    // Every userMemory replica is partitioned per user (see
    // `userMemoryIdentityScope`), so a workspace switch while the request is in
    // flight changes nothing below.
    const user = userMemoryIdentityScope.get();

    await memoryCRUDService.deleteAll();

    // Replica-backed reads own their state and persisted projection: wipe them
    // through the engine (memory + IndexedDB + reads in flight) before the
    // plain-state reset and the revalidation below, so a reload never
    // resurrects purged rows. Each `internal_clear*` retries once and resolves
    // `false` when a persisted row survived a storage failure (the next session
    // would hydrate it back). No slice resets its replica-owned fields here.
    //
    // `user` is the account whose memories the server deleted. If another
    // account became active while the request ran, each slice purges only that
    // user's persisted partition and leaves the active user's views and rows
    // alone (`clearUserReplicas`).
    const replicaPurges: boolean[] = [
      // One line per replica-backed slice.
      await this.#get().internal_clearMemoryReplicas(user),
      await this.#get().internal_clearTopicMemories(user),
      await this.#get().internal_clearHomeReplicas(user),
      await this.#get().internal_clearActivityList(user),
      await this.#get().internal_clearContextList(user),
      await this.#get().internal_clearExperienceList(user),
      await this.#get().internal_clearIdentityList(user),
      await this.#get().internal_clearPreferenceList(user),
    ];
    const purgeFailed = !replicaPurges.every(Boolean);

    // An account switch: the active views, plain state and mounted queries all
    // belong to the other user, so there is nothing to reset or refetch.
    if (userMemoryIdentityScope.get() !== user) {
      if (purgeFailed) throw new Error('Failed to purge persisted memories from local storage');
      return;
    }

    this.#set(
      produce((draft) => {
        draft.activeParams = undefined;
        draft.activeParamsKey = undefined;
        draft.editingMemoryContent = undefined;
        draft.editingMemoryId = undefined;
        draft.editingMemoryLayer = undefined;
      }),
      false,
      n('purgeAllMemories'),
    );

    // `clear()` does not refetch: revalidate every mounted read so the views
    // settle on the server's (now empty) answer. The lists, the retrieve map,
    // the detail and the home reads adopt their legacy SWR keys as sync keys;
    // identities (and the topic memories, see `internal_clearTopicMemories`)
    // sync under the replica's own keys.
    await Promise.all([
      ...[
        userMemoryKeys.activities.root,
        userMemoryKeys.contexts.root,
        userMemoryKeys.experiences.root,
        userMemoryKeys.memoryDetail.root,
        userMemoryKeys.preferences.root,
        userMemoryKeys.retrieve.root,
      ].map((root) =>
        mutate((key) => Array.isArray(key) && key[0] === root, undefined, { revalidate: true }),
      ),
      mutate(userMemoryKeys.persona(), undefined, { revalidate: true }),
      mutate(userMemoryKeys.tags(), undefined, { revalidate: true }),
      this.#get().refreshIdentities(),
    ]);

    // The in-memory reset above already stands — the user must not keep seeing
    // purged memories. Surface the rows that survived locally instead of
    // reporting a purge the next session would silently undo.
    if (purgeFailed) {
      throw new Error('Failed to purge persisted memories from local storage');
    }
  };

  refreshUserMemory = async (params: RetrieveMemoryParams): Promise<void> => {
    const key = userMemoryCacheKey(params);

    await mutate(userMemoryKeys.retrieve(key));
  };

  setActiveMemoryContext = (context?: MemoryContext): void => {
    const params = context ? createMemorySearchParams(context) : undefined;
    const key = params ? userMemoryCacheKey(params) : undefined;

    this.#set(
      { activeParams: params, activeParamsKey: key },
      false,
      n('setActiveMemoryContext', { key }),
    );
  };

  setEditingMemory = (
    id: string,
    content: string,
    layer: 'activity' | 'context' | 'experience' | 'identity' | 'preference',
  ): void => {
    this.#set(
      {
        editingMemoryContent: content,
        editingMemoryId: id,
        editingMemoryLayer: layer,
      },
      false,
      n('setEditingMemory', { id, layer }),
    );
  };

  /**
   * Save an inline edit. Every layer is replica-backed: its slice's
   * `internal_update<X>Entity` patches the row in every loaded query and in
   * the persisted rows of the ones not loaded, so a filter / sort switch or a
   * reload shows the edit before any refetch. The list and the detail are
   * then revalidated against the server.
   */
  updateMemory = async (id: string, content: string, layer: LayersEnum): Promise<void> => {
    const listRoot = (root: string) => () => mutate((key) => Array.isArray(key) && key[0] === root);
    let revalidateList: () => Promise<unknown>;

    switch (layer) {
      case LayersEnum.Activity: {
        await memoryCRUDService.updateActivity(id, { narrative: content });
        this.#get().internal_updateActivityEntity(id, (item) => ({ ...item, narrative: content }));
        revalidateList = listRoot(userMemoryKeys.activities.root);
        break;
      }
      case LayersEnum.Context: {
        await memoryCRUDService.updateContext(id, { description: content });
        this.#get().internal_updateContextEntity(id, (item) => ({ ...item, description: content }));
        revalidateList = listRoot(userMemoryKeys.contexts.root);
        break;
      }
      case LayersEnum.Experience: {
        await memoryCRUDService.updateExperience(id, { keyLearning: content });
        this.#get().internal_updateExperienceEntity(id, (item) => ({
          ...item,
          keyLearning: content,
        }));
        revalidateList = listRoot(userMemoryKeys.experiences.root);
        break;
      }
      case LayersEnum.Identity: {
        await memoryCRUDService.updateIdentity(id, { description: content });
        this.#get().internal_updateIdentityEntity(id, (item) => ({
          ...item,
          description: content,
        }));
        // The list and the self identities injected into chat sync under the
        // replica's own keys.
        revalidateList = this.#get().refreshIdentities;
        break;
      }
      case LayersEnum.Preference: {
        await memoryCRUDService.updatePreference(id, { conclusionDirectives: content });
        this.#get().internal_updatePreferenceEntity(id, (item) => ({
          ...item,
          conclusionDirectives: content,
        }));
        revalidateList = listRoot(userMemoryKeys.preferences.root);
        break;
      }
      default: {
        this.#get().clearEditingMemory();
        return;
      }
    }

    this.#get().clearEditingMemory();

    await Promise.all([revalidateList(), mutate(userMemoryKeys.memoryDetail(layer, id))]);
  };

  /**
   * Fetch orchestration for one memory detail. Returns an `SWRResponse`-shaped
   * value — `data` reads the replica view — so the existing right panels are
   * untouched; the detail lands in `memoryDetailMap`, never in this return value.
   */
  useFetchMemoryDetail = (id: string | null, layer: LayersEnum): SWRResponse<any> => {
    const sync: ReplicaSyncResult = this.#detail.useSync(id ? { id, layer } : null, {
      enabled: Boolean(id),
      revalidateOnFocus: false,
    });

    const detail = useUserMemoryStore((state) =>
      id ? state.memoryDetailMap[memoryDetailKey({ id, layer })] : undefined,
    );

    return {
      data: detail,
      error: sync.error,
      isLoading: !detail && (sync.isValidating || !sync.isHydrated),
      isValidating: sync.isValidating,
      mutate: sync.revalidate,
    } as unknown as SWRResponse<any>;
  };

  /**
   * Fetch orchestration for the retrieve memory map. The rows land in
   * `memoryMap` (keyed by the query cache key); this return value only carries
   * the sync flags, so any existing consumer keeps its shape.
   */
  useFetchUserMemory = (
    enable: boolean,
    params?: RetrieveMemoryParams,
  ): SWRResponse<RetrieveMemoryResult> => {
    const resolvedParams = params ?? this.#get().activeParams;
    const key = resolvedParams ? userMemoryCacheKey(resolvedParams) : undefined;

    const enabled = enable && Boolean(resolvedParams);
    const sync: ReplicaSyncResult = this.#retrieve.useSync(resolvedParams ?? null, { enabled });

    const data = useUserMemoryStore((state) => (key ? state.memoryMap[key] : undefined));

    return {
      data,
      error: sync.error,
      // A disabled read neither hydrates nor fetches: it is not loading (the
      // former null-SWR-key behaviour), even though its row is not hydrated.
      isLoading: enabled && !data && (sync.isValidating || !sync.isHydrated),
      isValidating: sync.isValidating,
      mutate: sync.revalidate,
    } as unknown as SWRResponse<RetrieveMemoryResult>;
  };
}

export type BaseAction = Pick<BaseActionImpl, keyof BaseActionImpl>;
