import type {
  AiProviderDetailItem,
  AiProviderListItem,
  AiProviderRuntimeState,
  EnabledProvider,
  ProviderConfig,
} from '@lobechat/types';
import { isEmpty } from 'es-toolkit/compat';
import {
  AIChatModelCard,
  AiModelSourceEnum,
  AiProviderModelListItem,
  EnabledAiModel,
} from 'model-bank';
import * as modelBank from 'model-bank';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';
import pMap from 'p-map';

import { merge, mergeArrayById } from '@/utils/merge';

import { AiModelModel } from '../../models/aiModel';
import { AiProviderModel } from '../../models/aiProvider';
import { LobeChatDatabase } from '../../type';

type DecryptUserKeyVaults = (encryptKeyVaultsStr: string | null) => Promise<any>;

/**
 * Provider-level search defaults (only used when built-in models don't provide settings.searchImpl and settings.searchProvider)
 * Note: Not stored in DB, only injected during read
 */
const PROVIDER_SEARCH_DEFAULTS: Record<
  string,
  { searchImpl?: 'tool' | 'params' | 'internal'; searchProvider?: string }
> = {
  ai360: { searchImpl: 'params' },
  aihubmix: { searchImpl: 'params' },
  anthropic: { searchImpl: 'params' },
  baichuan: { searchImpl: 'params' },
  default: { searchImpl: 'params' },
  google: { searchImpl: 'params', searchProvider: 'google' },
  hunyuan: { searchImpl: 'params' },
  jina: { searchImpl: 'internal' },
  minimax: { searchImpl: 'params' },
  // openai: defaults to params, but -search- models use internal as special case
  openai: { searchImpl: 'params' },
  // perplexity: defaults to internal
  perplexity: { searchImpl: 'internal' },
  qwen: { searchImpl: 'params' },
  spark: { searchImpl: 'params' }, // Some models (like max-32k) will prioritize built-in if marked as internal
  stepfun: { searchImpl: 'params' },
  vertexai: { searchImpl: 'params', searchProvider: 'google' },
  wenxin: { searchImpl: 'params' },
  xai: { searchImpl: 'params' },
  zhipu: { searchImpl: 'params' },
};

// Special model configuration - model-level settings override provider defaults
const MODEL_SEARCH_DEFAULTS: Record<
  string,
  Record<string, { searchImpl?: 'tool' | 'params' | 'internal'; searchProvider?: string }>
> = {
  openai: {
    'gpt-4o-mini-search-preview': { searchImpl: 'internal' },
    'gpt-4o-search-preview': { searchImpl: 'internal' },
    // Add other special model configurations here
  },
  spark: {
    'max-32k': { searchImpl: 'internal' },
  },
  // Add special model configurations for other providers here
};

// Infer default settings based on providerId + modelId
const inferProviderSearchDefaults = (
  providerId: string | undefined,
  modelId: string,
): { searchImpl?: 'tool' | 'params' | 'internal'; searchProvider?: string } => {
  const modelSpecificConfig = providerId ? MODEL_SEARCH_DEFAULTS[providerId]?.[modelId] : undefined;
  if (modelSpecificConfig) {
    return modelSpecificConfig;
  }

  return (providerId && PROVIDER_SEARCH_DEFAULTS[providerId]) || PROVIDER_SEARCH_DEFAULTS.default;
};

// Only inject settings during read; add or remove search-related fields in settings based on abilities.search
const injectSearchSettings = (providerId: string, item: any) => {
  const abilities = item?.abilities || {};

  // Model explicitly disables search capability: remove search-related fields from settings to prevent UI from showing built-in search
  if (abilities.search === false) {
    if (item?.settings?.searchImpl || item?.settings?.searchProvider) {
      const next = { ...item } as any;
      if (next.settings) {
        // eslint-disable-next-line unused-imports/no-unused-vars, @typescript-eslint/no-unused-vars
        const { searchImpl, searchProvider, ...restSettings } = next.settings;
        next.settings = Object.keys(restSettings).length > 0 ? restSettings : undefined;
      }
      return next;
    }
    return item;
  }

  // Model explicitly enables search capability: add search-related fields to settings
  else if (abilities.search === true) {
    // If built-in (local) model already has either field, preserve it without overriding
    if (item?.settings?.searchImpl || item?.settings?.searchProvider) return item;

    // Otherwise use providerId + modelId
    const searchSettings = inferProviderSearchDefaults(providerId, item.id);

    return {
      ...item,
      settings: {
        ...item.settings,
        ...searchSettings,
      },
    };
  }

  // Compatibility for legacy versions where database doesn't store abilities.search field
  return item;
};

export class AiInfraRepos {
  private userId: string;
  private db: LobeChatDatabase;
  aiProviderModel: AiProviderModel;
  private readonly providerConfigs: Record<string, ProviderConfig>;
  aiModelModel: AiModelModel;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    providerConfigs: Record<string, ProviderConfig>,
  ) {
    this.userId = userId;
    this.db = db;
    this.aiProviderModel = new AiProviderModel(db, userId);
    this.aiModelModel = new AiModelModel(db, userId);
    this.providerConfigs = providerConfigs;
  }

  /**
   * Calculate the final providerList based on the known providerConfig
   */
  getAiProviderList = async () => {
    const userProviders = await this.aiProviderModel.getAiProviderList();

    // 1. First create a mapping based on DEFAULT_MODEL_PROVIDER_LIST id order
    const orderMap = new Map(DEFAULT_MODEL_PROVIDER_LIST.map((item, index) => [item.id, index]));

    const builtinProviders = DEFAULT_MODEL_PROVIDER_LIST.map((item) => ({
      description: item.description,
      enabled:
        userProviders.some((provider) => provider.id === item.id && provider.enabled) ||
        this.providerConfigs[item.id]?.enabled,
      id: item.id,
      name: item.name,
      source: 'builtin',
    })) as AiProviderListItem[];

    const mergedProviders = mergeArrayById(builtinProviders, userProviders);

    // 3. Sort based on orderMap
    return mergedProviders.sort((a, b) => {
      const orderA = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const orderB = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });
  };

  /**
   * used in the chat page. to show the enabled providers
   */
  getUserEnabledProviderList = async () => {
    const list = await this.getAiProviderList();
    return list
      .filter((item) => item.enabled)
      .sort((a, b) => a.sort! - b.sort!)
      .map(
        (item): EnabledProvider => ({
          id: item.id,
          logo: item.logo,
          name: item.name,
          source: item.source,
        }),
      );
  };

  /**
   * used in the chat page. to show the enabled models
   */
  getEnabledModels = async (filterEnabled: boolean = true) => {
    const [providers, allModels] = await Promise.all([
      this.getAiProviderList(),
      this.aiModelModel.getAllModels(),
    ]);
    const enabledProviders = providers.filter((item) => (filterEnabled ? item.enabled : true));

    const builtinModelList = await pMap(
      enabledProviders,
      async (provider) => {
        const aiModels = await this.fetchBuiltinModels(provider.id);
        return (aiModels || [])
          .map<EnabledAiModel & { enabled?: boolean | null }>((item) => {
            const user = allModels.find((m) => m.id === item.id && m.providerId === provider.id);

            // User hasn't modified local model
            if (!user)
              return {
                ...item,
                abilities: item.abilities || {},
                providerId: provider.id,
              };

            const mergedModel = {
              ...item,
              abilities: !isEmpty(user.abilities) ? user.abilities : item.abilities || {},
              config: !isEmpty(user.config) ? user.config : item.config,
              contextWindowTokens:
                typeof user.contextWindowTokens === 'number'
                  ? user.contextWindowTokens
                  : item.contextWindowTokens,
              displayName: user?.displayName || item.displayName,
              enabled: typeof user.enabled === 'boolean' ? user.enabled : item.enabled,
              id: item.id,
              providerId: provider.id,
              settings: user.settings || item.settings,
              sort: user.sort || undefined,
              type: user.type || item.type,
            };
            return injectSearchSettings(provider.id, mergedModel); // User modified local model, check search settings
          })
          .filter((item) => (filterEnabled ? item.enabled : true));
      },
      { concurrency: 10 },
    );

    const enabledProviderIds = new Set(enabledProviders.map((item) => item.id));
    // User database models, check search settings
    const appendedUserModels = allModels
      .filter((item) =>
        filterEnabled ? enabledProviderIds.has(item.providerId) && item.enabled : true,
      )
      .map((item) => injectSearchSettings(item.providerId, item));

    return [...builtinModelList.flat(), ...appendedUserModels].sort(
      (a, b) => (a?.sort || -1) - (b?.sort || -1),
    ) as EnabledAiModel[];
  };

  getAiProviderRuntimeState = async (
    decryptor?: DecryptUserKeyVaults,
  ): Promise<AiProviderRuntimeState> => {
    const [result, enabledAiProviders, allModels] = await Promise.all([
      this.aiProviderModel.getAiProviderRuntimeConfig(decryptor),
      this.getUserEnabledProviderList(),
      this.getEnabledModels(false),
    ]);

    const runtimeConfig = result;
    Object.entries(result).forEach(([key, value]) => {
      runtimeConfig[key] = merge(this.providerConfigs[key] || {}, value);
    });
    const enabledAiModels = allModels.filter((model) => model.enabled);
    const enabledChatAiProviders = enabledAiProviders.filter((provider) => {
      return allModels.some((model) => model.providerId === provider.id && model.type === 'chat');
    });
    const enabledImageAiProviders = enabledAiProviders.filter((provider) => {
      return allModels.some((model) => model.providerId === provider.id && model.type === 'image');
    });

    return {
      enabledAiModels,
      enabledAiProviders,
      enabledChatAiProviders,
      enabledImageAiProviders,
      runtimeConfig,
    };
  };

  getAiProviderModelList = async (
    providerId: string,
    options?: {
      enabled?: boolean;
      limit?: number;
      offset?: number;
    },
  ) => {
    const aiModels = await this.aiModelModel.getModelListByProviderId(providerId);

    const defaultModels: AiProviderModelListItem[] =
      (await this.fetchBuiltinModels(providerId)) || [];
    // Not modifying search settings here doesn't affect usage, but done for data consistency on get
    const mergedModel = mergeArrayById(defaultModels, aiModels) as AiProviderModelListItem[];

    let list = mergedModel.map((m) =>
      injectSearchSettings(providerId, m),
    ) as AiProviderModelListItem[];

    if (typeof options?.enabled === 'boolean') {
      list = list.filter((m) => m.enabled === options.enabled);
    }

    if (typeof options?.offset === 'number' || typeof options?.limit === 'number') {
      const offset = Math.max(0, options?.offset ?? 0);
      const limit = options?.limit;
      if (typeof limit === 'number') return list.slice(offset, offset + Math.max(0, limit));
      return list.slice(offset);
    }

    return list;
  };

  /**
   * use in the `/settings/provider/[id]` page
   */
  getAiProviderDetail = async (id: string, decryptor?: DecryptUserKeyVaults) => {
    const config = await this.aiProviderModel.getAiProviderById(id, decryptor);

    return merge(this.providerConfigs[id] || {}, config) as AiProviderDetailItem;
  };

  /**
   * Fetch builtin models from config
   */
  private fetchBuiltinModels = async (
    providerId: string,
  ): Promise<AiProviderModelListItem[] | undefined> => {
    try {
      // TODO: when model-bank is a separate module, we will try import from model-bank/[prividerId] again
      // @ts-expect-error providerId is string
      const providerModels = modelBank[providerId];

      // use the serverModelLists as the defined server model list
      // fallback to empty array for custom provider
      const presetList = this.providerConfigs[providerId]?.serverModelLists || providerModels || [];

      return (presetList as AIChatModelCard[]).map<AiProviderModelListItem>((m) => ({
        ...m,
        enabled: m.enabled || false,
        source: AiModelSourceEnum.Builtin,
      }));
    } catch (error) {
      console.error(error);
      // maybe provider id not exist
    }
  };
}
