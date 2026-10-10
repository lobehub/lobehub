import isEqual from 'fast-deep-equal';
import { produce } from 'immer';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { userMemoryKeys } from '@/libs/swr/keys';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { type RetrieveMemoryParams, type RetrieveMemoryResult } from '@/types/userMemory';
import { LayersEnum } from '@/types/userMemory';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore } from '../../store';
import { userMemoryCacheKey } from '../../utils/cacheKey';
import { createMemorySearchParams } from '../../utils/searchParams';
import { activityInitialState } from '../activity/initialState';
import { contextInitialState } from '../context/initialState';
import { experienceInitialState } from '../experience/initialState';
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

  purgeAllMemories = async (): Promise<void> => {
    const { memoryCRUDService } = await import('@/services/userMemory');

    await memoryCRUDService.deleteAll();

    this.#set(
      produce((draft) => {
        Object.assign(draft, activityInitialState);
        Object.assign(draft, contextInitialState);
        Object.assign(draft, experienceInitialState);
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

    // The identity slices are replica-backed: their views (and persisted rows)
    // are cleared through the engine, not by assigning `initialState`.
    this.#get().resetIdentities();

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
      this.#get().refreshIdentities(),
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
        // The list is a replica: patch its view through the engine so the
        // persisted copy stays in step, then revalidate the head page.
        this.#get().patchIdentityInList(id, { description: content });
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
    } else if (layer === LayersEnum.Identity) {
      // Identity rows live in the replica; revalidate its head page (the local
      // patch above already updated the view).
      await Promise.all([
        this.#get().refreshIdentities(),
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
}

export type BaseAction = Pick<BaseActionImpl, keyof BaseActionImpl>;
