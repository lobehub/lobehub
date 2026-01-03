import isEqual from 'fast-deep-equal';
import type { SWRResponse } from 'swr';
import useSWR from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { mutate, useClientDataSWR, useClientDataSWRWithSync } from '@/libs/swr';
import { userMemoryService } from '@/services/userMemory';
import { LayersEnum } from '@/types/userMemory';
import type { RetrieveMemoryParams, RetrieveMemoryResult } from '@/types/userMemory';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore } from '../../store';
import type { IdentityForInjection } from '../../types';
import { userMemoryCacheKey } from '../../utils/cacheKey';
import { createMemorySearchParams } from '../../utils/searchParams';

const SWR_FETCH_USER_MEMORY = 'SWR_FETCH_USER_MEMORY';
const n = setNamespace('userMemory');

type MemoryContext = Parameters<typeof createMemorySearchParams>[0];

export interface BaseAction {
  clearEditingMemory: () => void;
  refreshUserMemory: (params: RetrieveMemoryParams) => Promise<void>;
  setActiveMemoryContext: (context?: MemoryContext) => void;
  setEditingMemory: (
    id: string,
    content: string,
    layer: 'context' | 'experience' | 'identity' | 'preference',
  ) => void;
  updateMemory: (id: string, content: string, layer: LayersEnum) => Promise<void>;
  useFetchMemoryDetail: (id: string | null, layer: LayersEnum) => SWRResponse<any>;
  useFetchUserMemory: (
    enable: boolean,
    params?: RetrieveMemoryParams,
  ) => SWRResponse<RetrieveMemoryResult>;
  /**
   * Initialize global identities at app startup
   * Fetches up to 50 most recent identities for chat context injection
   */
  useInitIdentities: (isLogin: boolean) => SWRResponse<any>;
}

export const createBaseSlice: StateCreator<
  UserMemoryStore,
  [['zustand/devtools', never]],
  [],
  BaseAction
> = (set, get) => ({
  clearEditingMemory: () => {
    set(
      {
        editingMemoryContent: undefined,
        editingMemoryId: undefined,
        editingMemoryLayer: undefined,
      },
      false,
      n('clearEditingMemory'),
    );
  },

  refreshUserMemory: async (params) => {
    const key = userMemoryCacheKey(params);

    await mutate([SWR_FETCH_USER_MEMORY, key]);
  },

  setActiveMemoryContext: (context) => {
    const params = context ? createMemorySearchParams(context) : undefined;
    const key = params ? userMemoryCacheKey(params) : undefined;

    set(
      { activeParams: params, activeParamsKey: key },
      false,
      n('setActiveMemoryContext', { key }),
    );
  },

  setEditingMemory: (id, content, layer) => {
    set(
      {
        editingMemoryContent: content,
        editingMemoryId: id,
        editingMemoryLayer: layer,
      },
      false,
      n('setEditingMemory', { id, layer }),
    );
  },

  updateMemory: async (id, content, layer) => {
    const { memoryCRUDService } = await import('@/services/userMemory');
    const { resetContextsList, resetExperiencesList, resetIdentitiesList, resetPreferencesList } =
      get();

    // Update the memory content based on layer
    switch (layer) {
      case LayersEnum.Context: {
        await memoryCRUDService.updateContext(id, { description: content });
        resetContextsList({ q: get().contextsQuery, sort: get().contextsSort });
        break;
      }
      case LayersEnum.Experience: {
        await memoryCRUDService.updateExperience(id, { keyLearning: content });
        resetExperiencesList({ q: get().experiencesQuery, sort: get().experiencesSort });
        break;
      }
      case LayersEnum.Identity: {
        await memoryCRUDService.updateIdentity(id, { description: content });
        resetIdentitiesList({ q: get().identitiesQuery, types: get().identitiesTypes });
        break;
      }
      case LayersEnum.Preference: {
        await memoryCRUDService.updatePreference(id, { conclusionDirectives: content });
        resetPreferencesList({ q: get().preferencesQuery, sort: get().preferencesSort });
        break;
      }
    }

    // Clear editing state
    get().clearEditingMemory();
  },

  useFetchMemoryDetail: (id, layer) => {
    const swrKey = id ? `memoryDetail-${layer}-${id}` : null;

    return useSWR(
      swrKey,
      async () => {
        if (!id) return null;

        const detail = await userMemoryService.getMemoryDetail({ id, layer });

        if (!detail) return null;

        // Transform nested structure to flat structure
        switch (layer) {
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
  },

  useFetchUserMemory: (enable, params) => {
    const resolvedParams = params ?? get().activeParams;
    const key = resolvedParams ? userMemoryCacheKey(resolvedParams) : undefined;

    return useClientDataSWR<RetrieveMemoryResult>(
      enable && resolvedParams ? [SWR_FETCH_USER_MEMORY, key] : null,
      () => userMemoryService.retrieveMemory(resolvedParams!),
      {
        onSuccess: (result) => {
          if (!resolvedParams || !key) return;

          const state = get();
          const previous = state.memoryMap[key];
          const next = result ?? { contexts: [], experiences: [], preferences: [] };
          const fetchedAt = Date.now();

          if (previous && isEqual(previous, next)) {
            set(
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
                  contexts: next.contexts.length,
                  experiences: next.experiences.length,
                  preferences: next.preferences.length,
                },
              }),
            );

            return;
          }

          set(
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
                contexts: next.contexts.length,
                experiences: next.experiences.length,
                preferences: next.preferences.length,
              },
            }),
          );
        },
      },
    );
  },

  useInitIdentities: (isLogin) => {
    return useClientDataSWRWithSync<IdentityForInjection[]>(
      isLogin ? 'useInitIdentities' : null,
      // Use dedicated API that filters for self identities only
      () => userMemoryService.queryIdentitiesForInjection({ limit: 25 }),
      {
        onSuccess: (data) => {
          if (!data) return;

          const fetchedAt = Date.now();

          set(
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
  },
});
