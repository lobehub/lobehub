import type { UserModelProviderConfig } from '@lobechat/types';
import { ModelProvider } from 'model-bank/modelProvider';
import opencodezenModels from 'model-bank/opencodeZen';

const enabledOpenCodeZenModels = opencodezenModels
  .filter(({ enabled }) => enabled)
  .map(({ id }) => id);

const providerDefaults: Partial<
  Record<ModelProvider, { enabled?: boolean; enabledModels?: string[]; fetchOnClient?: boolean }>
> = {
  [ModelProvider.Anthropic]: { enabled: true },
  [ModelProvider.DeepSeek]: { enabled: true },
  [ModelProvider.Google]: { enabled: true },
  [ModelProvider.LMStudio]: { fetchOnClient: true },
  [ModelProvider.Ollama]: { fetchOnClient: true },
  [ModelProvider.OpenAI]: { enabled: true },
  [ModelProvider.OpenCodeZen]: { enabledModels: enabledOpenCodeZenModels },
  [ModelProvider.Unsloth]: { fetchOnClient: true },
};

const genUserLLMConfig = (): UserModelProviderConfig => {
  return Object.values(ModelProvider).reduce((config, provider) => {
    const providerConfig = providerDefaults[provider];

    config[provider] = {
      enabled: providerConfig?.enabled ?? false,
      enabledModels: providerConfig?.enabledModels ?? [],
      ...(providerConfig?.fetchOnClient !== undefined && {
        fetchOnClient: providerConfig.fetchOnClient,
      }),
    };

    return config;
  }, {} as UserModelProviderConfig);
};

export const DEFAULT_LLM_CONFIG = genUserLLMConfig();
