import { toast } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';
import type {
  AiModelReasoningConfig,
  AiModelSortMap,
  AiProviderModelListItem,
  CreateAiModelParams,
  ToggleAiModelEnableParams,
} from 'model-bank';
import type { SWRResponse } from 'swr';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { aiModelKeys } from '@/libs/swr/keys';
import { aiModelService } from '@/services/aiModel';
import type { AiInfraStore } from '@/store/aiInfra/store';
import type { StoreSetter } from '@/store/types';

import { modelReasoningConfigKey } from './initialState';
import { aiModelListEntity, aiModelListResource } from './projection';
import { aiModelSelectors } from './selectors';
import { deduplicateRemoteModels } from './utils';

const MAX_DUPLICATE_MODEL_IDS_IN_WARNING = 3;

/** Sync result of one provider's model list: replica flags plus the SWR-era aliases. */
export interface AiProviderModelsSyncResult extends ReplicaSyncResult {
  /** The provider's models, `undefined` until the first entry lands. */
  data: AiProviderModelListItem[] | undefined;
  /** A request is in flight and there is nothing to show for this provider yet. */
  isLoading: boolean;
  /** Alias of `revalidate`, kept for the existing "reload / retry" controls. */
  mutate: () => Promise<unknown>;
}

type Setter = StoreSetter<AiInfraStore>;
export const createAiModelSlice = (set: Setter, get: () => AiInfraStore, _api?: unknown) =>
  new AiModelActionImpl(set, get, _api);

export class AiModelActionImpl {
  readonly #get: () => AiInfraStore;
  readonly #list;
  readonly #set: Setter;

  constructor(set: Setter, get: () => AiInfraStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#list = createReplicaSlice(aiModelListResource, {
      actionPrefix: 'aiModelList',
      entity: aiModelListEntity,
      fetcher: (providerId) => aiModelService.getAiProviderModelList(providerId),
      get,
      set,
      stateKey: 'aiModelListReplica',
      view: recordLens<AiInfraStore, AiProviderModelListItem[]>('aiModelListMap'),
    });
  }

  batchToggleAiModels = async (ids: string[], enabled: boolean): Promise<void> => {
    const { activeAiProvider } = this.#get();
    if (!activeAiProvider) return;

    await aiModelService.batchToggleAiModels(activeAiProvider, ids, enabled);
    await this.#get().refreshAiModelList();
  };

  batchUpdateAiModels = async (models: AiProviderModelListItem[]): Promise<void> => {
    const { activeAiProvider: id } = this.#get();
    if (!id) return;

    await aiModelService.batchUpdateAiModels(id, models);
    await this.#get().refreshAiModelList();
  };

  clearModelsByProvider = async (provider: string): Promise<void> => {
    await aiModelService.clearModelsByProvider(provider);
    await this.#get().refreshAiModelList();
  };

  clearRemoteModels = async (provider: string): Promise<void> => {
    await aiModelService.clearRemoteModels(provider);
    await this.#get().refreshAiModelList();
  };

  createNewAiModel = async (data: CreateAiModelParams): Promise<void> => {
    await aiModelService.createAiModel(data);
    await this.#get().refreshAiModelList();
  };

  fetchRemoteModelList = async (providerId: string): Promise<void> => {
    const { modelsService } = await import('@/services/models');

    const data = await modelsService.getModels(providerId);
    if (data) {
      // The provider's confirmed list is the replica view; keeping its enabled
      // flags avoids re-disabling models the user has already turned on.
      const currentEnabledState = new Map(
        (this.#get().aiModelListMap[providerId] ?? []).map(({ enabled, id }) => [id, enabled]),
      );
      const remoteModels = data.map<AiProviderModelListItem>((model) => {
        const hasAnyAbility =
          model.files ||
          model.functionCall ||
          model.imageOutput ||
          model.reasoning ||
          model.search ||
          model.video ||
          model.vision;

        return {
          ...model,
          ...(hasAnyAbility && {
            abilities: {
              files: model.files,
              functionCall: model.functionCall,
              imageOutput: model.imageOutput,
              reasoning: model.reasoning,
              search: model.search,
              video: model.video,
              vision: model.vision,
            },
          }),
          enabled: currentEnabledState.get(model.id) ?? model.enabled ?? false,
          source: 'remote',
          type: model.type ?? 'chat',
        };
      });
      const { duplicateIds, models, removedCount } = deduplicateRemoteModels(remoteModels);

      await this.#get().batchUpdateAiModels(models);

      if (removedCount > 0) {
        const visibleDuplicateIds = duplicateIds.slice(0, MAX_DUPLICATE_MODEL_IDS_IN_WARNING);
        const remainingCount = duplicateIds.length - visibleDuplicateIds.length;

        toast.warning(
          t(
            remainingCount > 0
              ? 'providerModels.list.fetcher.duplicatesRemovedWithMore'
              : 'providerModels.list.fetcher.duplicatesRemoved',
            {
              count: removedCount,
              ids: visibleDuplicateIds.join(', '),
              ns: 'modelProvider',
              remainingCount,
            },
          ),
        );
      }
    }
  };

  internal_toggleAiModelLoading = (id: string, loading: boolean): void => {
    this.#set(
      (state) => {
        if (loading) return { aiModelLoadingIds: [...state.aiModelLoadingIds, id] };

        return { aiModelLoadingIds: state.aiModelLoadingIds.filter((i) => i !== id) };
      },
      false,
      'toggleAiModelLoading',
    );
  };

  /**
   * Revalidate the loaded replica entries. Every write goes through here, so a
   * mutation reflects on whichever provider's list is currently rendered —
   * `revalidate()` with no key covers all loaded entries of the active scope,
   * which also keeps a non-active provider's cached list (a delete or a config
   * edit for another provider) from going stale.
   */
  refreshAiModelList = async (): Promise<void> => {
    await this.#list.revalidate();
    // make refresh provide runtime state async, not block
    this.#get().refreshAiProviderRuntimeState();
  };

  removeAiModel = async (id: string, providerId: string): Promise<void> => {
    await aiModelService.deleteAiModel({ id, providerId });
    await this.#get().refreshAiModelList();
  };

  /**
   * Toggle a model of an arbitrary provider, without requiring the provider settings
   * page context (`activeAiProvider`). Used by ModelSelect to re-enable a persisted
   * model that is no longer in the enabled list.
   */
  toggleProviderModelEnabled = async (params: ToggleAiModelEnableParams): Promise<void> => {
    this.#get().internal_toggleAiModelLoading(params.id, true);

    try {
      await aiModelService.toggleModelEnabled(params);
      await this.#get().refreshAiProviderRuntimeState();
    } finally {
      this.#get().internal_toggleAiModelLoading(params.id, false);
    }
  };

  toggleModelEnabled = async (
    params: Omit<ToggleAiModelEnableParams, 'providerId'>,
  ): Promise<void> => {
    const { activeAiProvider } = this.#get();
    if (!activeAiProvider) return;

    this.#get().internal_toggleAiModelLoading(params.id, true);

    await aiModelService.toggleModelEnabled({ ...params, providerId: activeAiProvider });
    await this.#get().refreshAiModelList();

    this.#get().internal_toggleAiModelLoading(params.id, false);
  };

  /**
   * Optimistically saves the user's per-model-instance reasoning defaults
   * (personal scope, cross-workspace). Rolls the local value back and surfaces
   * an error toast when the request fails.
   */
  updateModelReasoningConfig = async (
    id: string,
    provider: string,
    value: AiModelReasoningConfig,
  ): Promise<void> => {
    const key = modelReasoningConfigKey(provider, id);
    const previous = this.#get().modelReasoningConfigMap[key];

    this.#set(
      (state) => ({
        modelReasoningConfigMap: {
          ...state.modelReasoningConfigMap,
          [key]: { ...previous, ...value },
        },
        modelReasoningConfigUpdatingKeys: [...state.modelReasoningConfigUpdatingKeys, key],
      }),
      false,
      `updateModelReasoningConfig/optimistic/${key}`,
    );

    try {
      await aiModelService.updateAiModelReasoningConfig(id, provider, value);
    } catch (error) {
      this.#set(
        (state) => {
          const modelReasoningConfigMap = { ...state.modelReasoningConfigMap };
          // A leftover `[key]: undefined` would read as "cached empty" and stop
          // ensureModelReasoningConfig from ever fetching the server value
          if (previous === undefined) delete modelReasoningConfigMap[key];
          else modelReasoningConfigMap[key] = previous;
          return { modelReasoningConfigMap };
        },
        false,
        `updateModelReasoningConfig/rollback/${key}`,
      );

      toast.error(t('reasoningEffort.updateFailed', { ns: 'chat' }));
      throw error;
    } finally {
      this.#set(
        (state) => ({
          modelReasoningConfigUpdatingKeys: state.modelReasoningConfigUpdatingKeys.filter(
            (i) => i !== key,
          ),
        }),
        false,
        `updateModelReasoningConfig/settled/${key}`,
      );
    }

    // Revalidate only AFTER the updating marker is cleared: the server merges
    // this partial write into previously saved fields, and the fetch hook's
    // onSuccess skips writes while the key is marked updating — revalidating
    // inside the try block would drop server-preserved sibling fields whenever
    // the optimistic base (`previous`) had not been fetched yet.
    await mutate(aiModelKeys.reasoningConfig(provider, id));
  };

  /**
   * Best-effort imperative warm-up of the model-instance reasoning config for
   * non-React callers — e.g. the client sub-agent executor, whose override
   * model may never mount a ChatInput fetch hook. No-op when the key is
   * already cached or an optimistic update is in flight; fetch failures are
   * swallowed so the send path falls back to defaults instead of breaking.
   */
  ensureModelReasoningConfig = async (id: string, provider: string): Promise<void> => {
    // Right after a reload the model metadata may still be hydrating — settle
    // it first (bounded, no-op once loaded) so an unknown model isn't mistaken
    // for "no reasoning params" and skipped.
    await this.#get().ensureAiProviderRuntimeStateReady();

    // The config only matters for models declaring reasoning-family extend
    // params (resolveModelExtendParams ignores it otherwise) — skip the
    // blocking round trip for everything else.
    if (!aiModelSelectors.isModelHasReasoningExtendParams(id, provider)(this.#get())) return;

    const key = modelReasoningConfigKey(provider, id);
    if (key in this.#get().modelReasoningConfigMap) return;

    try {
      const data = await aiModelService.getAiModelReasoningConfig(id, provider);

      const state = this.#get();
      if (state.modelReasoningConfigUpdatingKeys.includes(key)) return;
      if (key in state.modelReasoningConfigMap) return;

      this.#set(
        (s) => ({
          // An empty config keeps the key (value undefined) so repeated calls
          // don't refetch a model that simply has nothing saved yet
          modelReasoningConfigMap: { ...s.modelReasoningConfigMap, [key]: data },
        }),
        false,
        `ensureModelReasoningConfig/${key}`,
      );
    } catch {
      // best-effort: resolver falls back to level defaults
    }
  };

  useFetchAiModelReasoningConfig = (
    id: string | undefined,
    provider: string | undefined,
  ): SWRResponse<AiModelReasoningConfig | null> => {
    return useClientDataSWR<AiModelReasoningConfig | null>(
      id && provider ? aiModelKeys.reasoningConfig(provider, id) : null,
      async ([, provider, id]) =>
        (await aiModelService.getAiModelReasoningConfig(id as string, provider as string)) ?? null,
      {
        onSuccess: (data) => {
          const key = modelReasoningConfigKey(provider!, id!);
          // Don't clobber an in-flight optimistic value with a stale response
          if (this.#get().modelReasoningConfigUpdatingKeys.includes(key)) return;
          // The store map keeps its `| undefined` shape — only SWR needs null.
          const value = data ?? undefined;
          if (isEqual(value, this.#get().modelReasoningConfigMap[key])) return;

          this.#set(
            (state) => ({
              modelReasoningConfigMap: { ...state.modelReasoningConfigMap, [key]: value },
            }),
            false,
            `useFetchAiModelReasoningConfig/${key}`,
          );
        },
      },
    );
  };

  updateAiModelsConfig = async (
    id: string,
    providerId: string,
    data: Partial<AiProviderModelListItem>,
  ): Promise<void> => {
    await aiModelService.updateAiModel(id, providerId, data);
    await this.#get().refreshAiModelList();
  };

  updateAiModelsSort = async (id: string, items: AiModelSortMap[]): Promise<void> => {
    await aiModelService.updateAiModelOrder(id, items);
    await this.#get().refreshAiModelList();
  };

  /**
   * Fetch orchestration for one provider's model list. Hydrates the persisted
   * copy first (so a revisit paints without a skeleton), then lets the network
   * confirm. Read the rows through `aiModelSelectors` /
   * `aiModelListMap[providerId]`, not from this return value.
   */
  useFetchAiProviderModels = (id: string): AiProviderModelsSyncResult => {
    const sync = this.#list.useSync(id || null);
    const data = id ? this.#get().aiModelListMap[id] : undefined;

    return {
      data,
      error: sync.error,
      isHydrated: sync.isHydrated,
      isLoading: sync.isValidating && data === undefined,
      isValidating: sync.isValidating,
      mutate: sync.revalidate,
      revalidate: sync.revalidate,
    };
  };
}

export type AiModelAction = Pick<AiModelActionImpl, keyof AiModelActionImpl>;
