import { produce } from 'immer';
import { type SWRResponse } from 'swr';

import { createReplicaSlice, type ReplicaLens, type ReplicaSyncResult } from '@/libs/replica';
import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { userMemoryKeys } from '@/libs/swr/keys';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { type RetrieveMemoryParams, type RetrieveMemoryResult } from '@/types/userMemory';
import { LayersEnum } from '@/types/userMemory';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore, useUserMemoryStore } from '../../store';
import { type IdentityForInjection } from '../../types';
import { userMemoryCacheKey } from '../../utils/cacheKey';
import { createMemorySearchParams } from '../../utils/searchParams';
import { activityInitialState } from '../activity/initialState';
import { contextInitialState } from '../context/initialState';
import { experienceInitialState } from '../experience/initialState';
import { identityInitialState } from '../identity/initialState';
import { preferenceInitialState } from '../preference/initialState';
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

  /** PersonaHeader confirmation deletes the persona through memoryCRUDService, then clears its cache. */
  deletePersona = async (): Promise<void> => {
    const { memoryCRUDService } = await import('@/services/userMemory');
    await mutate(
      userMemoryKeys.persona(),
      async () => {
        await memoryCRUDService.deletePersona();
        this.#set({ persona: undefined, personaInit: true }, false, n('deletePersona'));
        return null;
      },
      { revalidate: false },
    );
  };

  /**
   * Flatten the nested detail response into the shape the right-hand panel
   * reads. `undefined` means "no such memory", which the panel renders as empty.
   */
  #fetchDetail = async ({
    id,
    layer,
  }: MemoryDetailParams): Promise<MemoryDetailDisplay | undefined> => {
    const detail = await userMemoryService.getMemoryDetail({ id, layer });
    if (!detail || detail.layer !== layer) return undefined;

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
        return undefined;
      }
    }
  };

  purgeAllMemories = async (): Promise<void> => {
    const { memoryCRUDService } = await import('@/services/userMemory');

    await memoryCRUDService.deleteAll();

    // The retrieve / detail reads are replica-backed: drop their views (and the
    // persisted rows) through the engine, not by assigning plain state.
    this.resetMemoryCaches();

    this.#set(
      produce((draft) => {
        Object.assign(draft, activityInitialState);
        Object.assign(draft, contextInitialState);
        Object.assign(draft, experienceInitialState);
        Object.assign(draft, identityInitialState);
        Object.assign(draft, preferenceInitialState);

        draft.activeParams = undefined;
        draft.activeParamsKey = undefined;
        draft.editingMemoryContent = undefined;
        draft.editingMemoryId = undefined;
        draft.editingMemoryLayer = undefined;
        draft.persona = undefined;
        draft.personaInit = true;
        draft.roles = [];
        draft.tags = [];
        draft.tagsInit = true;
      }),
      false,
      n('purgeAllMemories'),
    );

    await Promise.all([
      mutate((key) => Array.isArray(key) && key[0] === userMemoryKeys.activities.root, undefined, {
        revalidate: true,
      }),
      mutate((key) => Array.isArray(key) && key[0] === userMemoryKeys.contexts.root, undefined, {
        revalidate: true,
      }),
      mutate((key) => Array.isArray(key) && key[0] === userMemoryKeys.experiences.root, undefined, {
        revalidate: true,
      }),
      mutate(
        (key) => Array.isArray(key) && key[0] === userMemoryKeys.identityList.root,
        undefined,
        {
          revalidate: true,
        },
      ),
      mutate((key) => Array.isArray(key) && key[0] === userMemoryKeys.preferences.root, undefined, {
        revalidate: true,
      }),
      mutate(userMemoryKeys.persona(), null, { revalidate: false }),
      mutate(
        userMemoryKeys.tags(),
        {
          roles: [],
          tags: [],
        },
        { revalidate: false },
      ),
    ]);
  };

  refreshUserMemory = async (params: RetrieveMemoryParams): Promise<void> => {
    const key = userMemoryCacheKey(params);

    await mutate(userMemoryKeys.retrieve(key));
  };

  /**
   * Drop every retrieve / detail view of the active scope through the replica
   * engine, so the persisted rows go with them. Used by the memory purge.
   */
  resetMemoryCaches = (): void => {
    for (const key of Object.keys(this.#get().memoryMap)) this.#retrieve.remove(key);
    for (const key of Object.keys(this.#get().memoryDetailMap)) this.#detail.remove(key);
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

  updateMemory = async (id: string, content: string, layer: LayersEnum): Promise<void> => {
    let listKeyRoot: string | undefined;

    switch (layer) {
      case LayersEnum.Activity: {
        await memoryCRUDService.updateActivity(id, { narrative: content });
        this.#set(
          produce((draft) => {
            const item = draft.activities.find((memory) => memory.id === id);
            if (item) item.narrative = content;
          }),
          false,
          n('updateMemory/activity'),
        );
        listKeyRoot = userMemoryKeys.activities.root;
        break;
      }
      case LayersEnum.Context: {
        await memoryCRUDService.updateContext(id, { description: content });
        this.#set(
          produce((draft) => {
            const item = draft.contexts.find((memory) => memory.id === id);
            if (item) item.description = content;
          }),
          false,
          n('updateMemory/context'),
        );
        listKeyRoot = userMemoryKeys.contexts.root;
        break;
      }
      case LayersEnum.Experience: {
        await memoryCRUDService.updateExperience(id, { keyLearning: content });
        this.#set(
          produce((draft) => {
            const item = draft.experiences.find((memory) => memory.id === id);
            if (item) item.keyLearning = content;
          }),
          false,
          n('updateMemory/experience'),
        );
        listKeyRoot = userMemoryKeys.experiences.root;
        break;
      }
      case LayersEnum.Identity: {
        await memoryCRUDService.updateIdentity(id, { description: content });
        this.#set(
          produce((draft) => {
            const item = draft.identities.find((memory) => memory.id === id);
            if (item) item.description = content;
          }),
          false,
          n('updateMemory/identity'),
        );
        listKeyRoot = userMemoryKeys.identityList.root;
        break;
      }
      case LayersEnum.Preference: {
        await memoryCRUDService.updatePreference(id, { conclusionDirectives: content });
        this.#set(
          produce((draft) => {
            const item = draft.preferences.find((memory) => memory.id === id);
            if (item) item.conclusionDirectives = content;
          }),
          false,
          n('updateMemory/preference'),
        );
        listKeyRoot = userMemoryKeys.preferences.root;
        break;
      }
    }

    this.#get().clearEditingMemory();

    if (listKeyRoot) {
      await Promise.all([
        mutate((key) => Array.isArray(key) && key[0] === listKeyRoot),
        mutate(userMemoryKeys.memoryDetail(layer, id)),
      ]);
    }
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

    const sync: ReplicaSyncResult = this.#retrieve.useSync(resolvedParams ?? null, {
      enabled: enable && Boolean(resolvedParams),
    });

    const data = useUserMemoryStore((state) => (key ? state.memoryMap[key] : undefined));

    return {
      data,
      error: sync.error,
      isLoading: !data && (sync.isValidating || !sync.isHydrated),
      isValidating: sync.isValidating,
      mutate: sync.revalidate,
    } as unknown as SWRResponse<RetrieveMemoryResult>;
  };

  useInitIdentities = (isLogin: boolean): SWRResponse<any> => {
    return useClientDataSWRWithSync<IdentityForInjection[]>(
      isLogin ? userMemoryKeys.identities() : null,
      // Use dedicated API that filters for self identities only
      () => userMemoryService.queryIdentitiesForInjection({ limit: 25 }),
      {
        onSuccess: (data) => {
          if (!data) return;

          const fetchedAt = Date.now();

          this.#set(
            {
              globalIdentities: data,
              globalIdentitiesFetchedAt: fetchedAt,
              globalIdentitiesInit: true,
            },
            false,
            n('useInitIdentities/success', { count: data.length }),
          );
        },
      },
    );
  };
}

export type BaseAction = Pick<BaseActionImpl, keyof BaseActionImpl>;
