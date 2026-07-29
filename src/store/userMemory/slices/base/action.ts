import isEqual from 'fast-deep-equal';
import { produce } from 'immer';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { mutate, useClientDataSWR, useClientDataSWRWithSync } from '@/libs/swr';
import { userMemoryKeys } from '@/libs/swr/keys';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { type RetrieveMemoryParams, type RetrieveMemoryResult } from '@/types/userMemory';
import { LayersEnum } from '@/types/userMemory';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore } from '../../store';
import { type IdentityForInjection } from '../../types';
import { userMemoryCacheKey } from '../../utils/cacheKey';
import { createMemorySearchParams } from '../../utils/searchParams';
import { activityInitialState } from '../activity/initialState';
import { contextInitialState } from '../context/initialState';
import { experienceInitialState } from '../experience/initialState';
import { identityInitialState } from '../identity/initialState';
import { preferenceInitialState } from '../preference/initialState';

const n = setNamespace('userMemory');

type MemoryContext = Parameters<typeof createMemorySearchParams>[0];

type Setter = StoreSetter<UserMemoryStore>;
export const createBaseSlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new BaseActionImpl(set, get, _api);

export class BaseActionImpl {
  readonly #get: () => UserMemoryStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
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

  purgeAllMemories = async (): Promise<void> => {
    const { memoryCRUDService } = await import('@/services/userMemory');

    await memoryCRUDService.deleteAll();

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
        draft.memoryFetchedAtMap = {};
        draft.memoryMap = {};
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
      mutate(
        (key) => Array.isArray(key) && key[0] === userMemoryKeys.memoryDetail.root,
        undefined,
        { revalidate: true },
      ),
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
      mutate((key) => Array.isArray(key) && key[0] === userMemoryKeys.retrieve.root, undefined, {
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

  useFetchMemoryDetail = (id: string | null, layer: LayersEnum): SWRResponse<any> => {
    const swrKey = id ? userMemoryKeys.memoryDetail(layer, id) : null;

    return useSWR(
      swrKey,
      async () => {
        if (!id) return null;

        const detail = await userMemoryService.getMemoryDetail({ id, layer });

        if (!detail) return null;

        // Transform nested structure to flat structure
        switch (layer) {
          case LayersEnum.Activity: {
            if (detail.layer === LayersEnum.Activity) {
              return {
                ...detail.memory,
                ...detail.activity,
                source: detail.source,
                sourceType: detail.sourceType,
              };
            }
            break;
          }
          case LayersEnum.Context: {
            if (detail.layer === LayersEnum.Context) {
              return {
                ...detail.memory,
                ...detail.context,
                source: detail.source,
                sourceType: detail.sourceType,
              };
            }
            break;
          }
          case LayersEnum.Experience: {
            if (detail.layer === LayersEnum.Experience) {
              return {
                ...detail.memory,
                ...detail.experience,
                source: detail.source,
                sourceType: detail.sourceType,
              };
            }
            break;
          }
          case LayersEnum.Identity: {
            if (detail.layer === LayersEnum.Identity) {
              return {
                ...detail.memory,
                ...detail.identity,
                source: detail.source,
                sourceType: detail.sourceType,
              };
            }
            break;
          }
          case LayersEnum.Preference: {
            if (detail.layer === LayersEnum.Preference) {
              return {
                ...detail.memory,
                ...detail.preference,
                source: detail.source,
                sourceType: detail.sourceType,
              };
            }
            break;
          }
        }

        return null;
      },
      {
        revalidateOnFocus: false,
      },
    );
  };

  useFetchUserMemory = (
    enable: boolean,
    params?: RetrieveMemoryParams,
  ): SWRResponse<RetrieveMemoryResult> => {
    const resolvedParams = params ?? this.#get().activeParams;
    const key = resolvedParams ? userMemoryCacheKey(resolvedParams) : undefined;

    return useClientDataSWR<RetrieveMemoryResult>(
      enable && resolvedParams ? userMemoryKeys.retrieve(key) : null,
      () => userMemoryService.retrieveMemory(resolvedParams!),
      {
        onSuccess: (result) => {
          if (!resolvedParams || !key) return;

          const state = this.#get();
          const previous = state.memoryMap[key];
          const next = result ?? { activities: [], contexts: [], experiences: [], preferences: [] };
          const fetchedAt = Date.now();

          if (previous && isEqual(previous, next)) {
            this.#set(
              {
                memoryFetchedAtMap: {
                  ...state.memoryFetchedAtMap,
                  [key]: fetchedAt,
                },
              },
              false,
              n('useFetchUserMemory/refresh', {
                key,
                totals: {
                  activities: next.activities.length,
                  contexts: next.contexts.length,
                  experiences: next.experiences.length,
                  preferences: next.preferences.length,
                },
              }),
            );

            return;
          }

          this.#set(
            {
              memoryFetchedAtMap: {
                ...state.memoryFetchedAtMap,
                [key]: fetchedAt,
              },
              memoryMap: {
                ...state.memoryMap,
                [key]: next,
              },
            },
            false,
            n('useFetchUserMemory/success', {
              key,
              totals: {
                activities: next.activities.length,
                contexts: next.contexts.length,
                experiences: next.experiences.length,
                preferences: next.preferences.length,
              },
            }),
          );
        },
      },
    );
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
