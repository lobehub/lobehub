import { type ChatModelCard, type ProviderConfig } from '@lobechat/types';
import { type AiFullModelCard } from 'model-bank';
import { ModelProvider } from 'model-bank';
import * as AiModels from 'model-bank';

import { getLLMConfig } from '@/envs/llm';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import { extractEnabledModels, transformToAiModelList } from '@/utils/server/parseModels';

interface ProviderSpecificConfig {
  autoFetchModelLists?: boolean;
  enabled?: boolean;
  enabledKey?: string;
  fetchOnClient?: boolean;
  modelListKey?: string;
  withDeploymentName?: boolean;
}

const providerRemoteModelCache = new Map<string, Promise<ChatModelCard[] | undefined>>();

const isLikelyGoogleModel = (id: string) =>
  /gemini|gemma|learnlm|imagen|veo|nano-banana/i.test(id.toLowerCase());

const toServerModelCard = (
  remoteModel: ChatModelCard,
  knownModel?: AiFullModelCard,
): AiFullModelCard => {
  const base = knownModel || ({} as AiFullModelCard);

  return {
    ...base,
    abilities: base.abilities || {
      files: remoteModel.files,
      functionCall: remoteModel.functionCall,
      imageOutput: remoteModel.imageOutput,
      reasoning: remoteModel.reasoning,
      search: remoteModel.search,
      video: remoteModel.video,
      vision: remoteModel.vision,
    },
    contextWindowTokens: remoteModel.contextWindowTokens ?? base.contextWindowTokens,
    displayName: remoteModel.displayName || base.displayName || remoteModel.id,
    enabled: true,
    id: remoteModel.id,
    maxOutput: remoteModel.maxOutput ?? base.maxOutput,
    pricing: remoteModel.pricing ?? base.pricing,
    releasedAt: remoteModel.releasedAt ?? base.releasedAt,
    settings: remoteModel.settings ?? base.settings,
    type: remoteModel.type ?? base.type ?? 'chat',
  };
};

const getCachedRemoteModels = (
  cacheKey: string,
  getter: () => Promise<ChatModelCard[] | undefined>,
) => {
  if (!providerRemoteModelCache.has(cacheKey)) {
    providerRemoteModelCache.set(
      cacheKey,
      getter().catch((error) => {
        console.warn(
          `[globalConfig] failed to fetch remote model list for ${cacheKey.split('|')[0]}`,
          error,
        );
        return undefined;
      }),
    );
  }

  return providerRemoteModelCache.get(cacheKey)!;
};

const fetchRemoteModelsByProvider = async (
  provider: string,
  apiKey: string,
  baseURL: string,
): Promise<ChatModelCard[] | undefined> => {
  const cacheKey = `${provider}|${baseURL}|${apiKey}`;

  return getCachedRemoteModels(cacheKey, async () => {
    const runtime = initModelRuntimeWithUserPayload(
      provider,
      { apiKey, baseURL, runtimeProvider: provider } as any,
      {
        id: provider,
      },
    );

    return runtime.models();
  });
};

const resolveAutoFetchedModelList = async ({
  defaultModels,
  llmConfig,
  provider,
  providerConfig,
}: {
  defaultModels: AiFullModelCard[];
  llmConfig: Record<string, any>;
  provider: string;
  providerConfig: ProviderSpecificConfig;
}) => {
  if (!providerConfig.autoFetchModelLists) return;

  const upperProvider = provider.toUpperCase();
  const apiKey = llmConfig[`${upperProvider}_API_KEY`];
  const baseURL = process.env[`${upperProvider}_PROXY_URL`];

  // Only auto-fetch when a proxy URL is explicitly configured.
  // This keeps default cloud behavior unchanged and avoids extra network calls.
  if (!apiKey || !baseURL) return;

  let remoteModels = await fetchRemoteModelsByProvider(provider, apiKey, baseURL);

  // Some gateways expose Gemini models via OpenAI-compatible /models endpoint.
  // Fallback to OpenAI runtime for Google provider and keep only Google-like model ids.
  if ((!remoteModels || remoteModels.length === 0) && provider === 'google') {
    const openAIStyleModels = await fetchRemoteModelsByProvider('openai', apiKey, baseURL);
    remoteModels = openAIStyleModels?.filter((model) => isLikelyGoogleModel(model.id));
  }

  if (!remoteModels || remoteModels.length === 0) return;

  const defaultModelMap = new Map(defaultModels.map((model) => [model.id.toLowerCase(), model]));
  const deduped = new Map<string, AiFullModelCard>();

  for (const remoteModel of remoteModels) {
    const normalizedId = remoteModel.id.toLowerCase();
    const knownModel = defaultModelMap.get(normalizedId);

    deduped.set(normalizedId, toServerModelCard(remoteModel, knownModel));
  }

  return Array.from(deduped.values());
};

export const genServerAiProvidersConfig = async (
  specificConfig: Record<any, ProviderSpecificConfig>,
) => {
  const llmConfig = getLLMConfig() as Record<string, any>;

  // Process all providers concurrently
  const providerConfigs = await Promise.all(
    Object.values(ModelProvider).map(async (provider) => {
      const providerUpperCase = provider.toUpperCase();
      const aiModels = AiModels[provider] as AiFullModelCard[];

      if (!aiModels)
        throw new Error(
          `Provider [${provider}] not found in aiModels, please make sure you have exported the provider in the \`aiModels/index.ts\``,
        );

      const providerConfig = specificConfig[provider as keyof typeof specificConfig] || {};
      const modelString =
        process.env[providerConfig.modelListKey ?? `${providerUpperCase}_MODEL_LIST`];

      // Process extractEnabledModels and transformToAiModelList concurrently
      const [enabledModels, transformedServerModelLists] = await Promise.all([
        extractEnabledModels(provider, modelString, providerConfig.withDeploymentName || false),
        transformToAiModelList({
          defaultModels: aiModels || [],
          modelString,
          providerId: provider,
          withDeploymentName: providerConfig.withDeploymentName || false,
        }),
      ]);

      const autoFetchedServerModelLists = modelString
        ? undefined
        : await resolveAutoFetchedModelList({
            defaultModels: aiModels || [],
            llmConfig,
            provider,
            providerConfig,
          });

      const serverModelLists = autoFetchedServerModelLists || transformedServerModelLists;

      return {
        config: {
          ...(providerConfig.autoFetchModelLists !== undefined && {
            autoFetchModelLists: providerConfig.autoFetchModelLists,
          }),
          enabled:
            typeof providerConfig.enabled !== 'undefined'
              ? providerConfig.enabled
              : llmConfig[providerConfig.enabledKey || `ENABLED_${providerUpperCase}`],
          enabledModels,
          serverModelLists,
          ...(providerConfig.fetchOnClient !== undefined && {
            fetchOnClient: providerConfig.fetchOnClient,
          }),
        },
        provider,
      };
    }),
  );

  // Convert the results to an object
  const config = {} as Record<string, ProviderConfig>;
  for (const { provider, config: providerConfig } of providerConfigs) {
    config[provider] = providerConfig;
  }

  return config;
};
