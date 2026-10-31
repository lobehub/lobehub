import type { ModelRuntimeHooks } from '@lobechat/model-runtime';
import { ModelRuntime } from '@lobechat/model-runtime';
import type { AiProviderRuntimeState, UserServiceModelConfig } from '@lobechat/types';
import debug from 'debug';

import { getBusinessModelRuntimeHooks } from '@/business/server/model-runtime';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import type { MemoryAgentConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { getUserScopedAiProviderRuntimeState } from '@/server/services/aiProviderAccess';
import type { GlobalMemoryLayer } from '@/types/serverConfig';
import type { LayersEnum } from '@/types/userMemory';
import { resolveEmbeddingTokenLimit } from '@/utils/tokenizer/embedding';

import type { MemoryExtractionExecutorContext } from './context';
import type { ResolvedMemoryServiceConfig, RuntimeBundle } from './types';

export type ProviderKeyVaultMap = Record<
  string,
  AiProviderRuntimeState['runtimeConfig'][string]['keyVaults'] | undefined
>;

const normalizeProvider = (provider: string) => provider.toLowerCase();

const extractCredentialsFromVault = (vault?: Record<string, unknown>) => {
  if (!vault || typeof vault !== 'object') return {};

  const apiKey = 'apiKey' in vault && typeof vault.apiKey === 'string' ? vault.apiKey : undefined;
  const baseURL =
    'baseURL' in vault && typeof vault.baseURL === 'string' ? vault.baseURL : undefined;

  return { apiKey, baseURL };
};

export const resolveLayerModels = (
  layers: Partial<Record<GlobalMemoryLayer, string>> | undefined,
  fallback: Record<GlobalMemoryLayer, string>,
): Record<LayersEnum, string> => ({
  activity: layers?.activity ?? fallback.activity,
  context: layers?.context ?? fallback.context,
  experience: layers?.experience ?? fallback.experience,
  identity: layers?.identity ?? fallback.identity,
  preference: layers?.preference ?? fallback.preference,
});

const maskSecret = (value?: string) => {
  if (!value) return 'undefined';
  if (value.length <= 8) return `${value[0]}***${value.at(-1)}`;

  return `${value.slice(0, 6)}***${value.slice(-4)}`;
};

export type ProviderCredential = { apiKey?: string; baseURL?: string };

export type RuntimeResolveOptions = {
  fallback?: ProviderCredential;
  preferred?: {
    providerIds?: string[];
  };
  userId?: string;
};

export const resolveRuntimeAgentConfig = (
  agent: MemoryAgentConfig,
  keyVaults?: ProviderKeyVaultMap,
  options?: RuntimeResolveOptions,
  hooks?: ModelRuntimeHooks,
) => {
  const normalizedPreferredProviders = (options?.preferred?.providerIds || [])
    .map(normalizeProvider)
    .filter(Boolean);

  const providerOrder = Array.from(
    new Set([
      ...normalizedPreferredProviders,
      normalizeProvider(agent.provider || 'openai'),
      ...Object.keys(keyVaults || {}),
    ]),
  );

  for (const provider of providerOrder) {
    if (provider === 'lobehub') {
      debugRuntimeInit(agent, {
        provider,
        source: 'user-vault' as const,
      });

      return ModelRuntime.initializeWithProvider(provider, { userId: options?.userId }, hooks);
    }

    const { apiKey: userApiKey, baseURL: userBaseURL } = extractCredentialsFromVault(
      keyVaults?.[provider],
    );
    if (!userApiKey) {
      console.warn(
        `[memory-extraction] skipping provider ${provider} due to missing API key in user vault`,
      );
      continue;
    }

    debugRuntimeInit(agent, {
      apiKey: userApiKey,
      baseURL: userBaseURL,
      provider,
      source: 'user-vault' as const,
    });

    // Only use the user baseURL if we are also using their API key; otherwise fall back entirely
    // to system config to avoid mixing credentials.
    return ModelRuntime.initializeWithProvider(provider, {
      apiKey: userApiKey,
      baseURL: userBaseURL,
      userId: options?.userId,
    });
  }

  debugRuntimeInit(agent, {
    apiKey: agent.apiKey || options?.fallback?.apiKey,
    baseURL: agent.baseURL || options?.fallback?.baseURL,
    provider: agent.provider || 'openai',
    source: 'system-config' as const,
  });

  return ModelRuntime.initializeWithProvider(agent.provider || 'openai', {
    apiKey: agent.apiKey || options?.fallback?.apiKey,
    baseURL: agent.baseURL || options?.fallback?.baseURL,
    userId: options?.userId,
  });
};

const logRuntime = debug('lobe-server:memory:user-memory:runtime');

const debugRuntimeInit = (
  agent: MemoryAgentConfig,
  resolved: {
    apiKey?: string;
    baseURL?: string;
    provider: string;
    source: 'user-vault' | 'system-config';
  },
) => {
  if (!logRuntime.enabled) return;
  logRuntime('init runtime', {
    agentModel: agent.model,
    agentProvider: agent.provider || 'openai',
    apiKey: maskSecret(resolved.apiKey),
    baseURL: resolved.baseURL,
    provider: resolved.provider,
    source: resolved.source,
  });
};

export function resolveUserMemoryAgent(
  systemAgent: Partial<UserServiceModelConfig> | undefined,
  key: keyof Pick<
    UserServiceModelConfig,
    'userMemoryEmbedding' | 'memoryAnalysisAgentConfig' | 'userMemoryPersonaWriter'
  >,
  fallback: MemoryAgentConfig,
): MemoryAgentConfig {
  const override = systemAgent?.[key];
  const provider = override?.provider || fallback.provider;
  const shouldInheritCredentials =
    !override?.provider ||
    normalizeProvider(override.provider) === normalizeProvider(fallback.provider || 'openai');
  const contextLimit =
    typeof override?.contextLimit === 'number' &&
    Number.isFinite(override.contextLimit) &&
    override.contextLimit > 0
      ? Math.floor(override.contextLimit)
      : fallback.contextLimit;

  return {
    apiKey: shouldInheritCredentials ? fallback.apiKey : undefined,
    baseURL: shouldInheritCredentials ? fallback.baseURL : undefined,
    contextLimit,
    language: fallback.language,
    model: override?.model || fallback.model,
    provider,
  };
}

export function resolveUserMemoryServiceConfig(
  ctx: MemoryExtractionExecutorContext,
  systemAgent?: Partial<UserServiceModelConfig>,
): ResolvedMemoryServiceConfig {
  const gatekeeper = ctx.resolveUserMemoryAgent(
    systemAgent,
    'memoryAnalysisAgentConfig',
    ctx.privateConfig.agentGateKeeper,
  );
  const layerExtractor = ctx.resolveUserMemoryAgent(
    systemAgent,
    'memoryAnalysisAgentConfig',
    ctx.privateConfig.agentLayerExtractor,
  );
  const embedding = ctx.resolveUserMemoryAgent(
    systemAgent,
    'userMemoryEmbedding',
    ctx.privateConfig.embedding,
  );
  const layerModels = systemAgent?.memoryAnalysisAgentConfig?.model
    ? {
        activity: layerExtractor.model,
        context: layerExtractor.model,
        experience: layerExtractor.model,
        identity: layerExtractor.model,
        preference: layerExtractor.model,
      }
    : resolveLayerModels(undefined, ctx.privateConfig.agentLayerExtractor.layers);

  return {
    agents: {
      embedding,
      gatekeeper,
      layerExtractor,
    },
    embeddingContextLimit:
      resolveEmbeddingTokenLimit(embedding.model, embedding.contextLimit) ??
      layerExtractor.contextLimit,
    extractorContextLimit: layerExtractor.contextLimit,
    modelConfig: {
      embeddingsModel: embedding.model,
      gateModel: gatekeeper.model,
      layerModels,
      observabilityS3: ctx.privateConfig.observabilityS3,
    },
    overrides: {
      embedding: {
        model: Boolean(systemAgent?.userMemoryEmbedding?.model),
        provider: Boolean(systemAgent?.userMemoryEmbedding?.provider),
      },
      gatekeeper: {
        model: Boolean(systemAgent?.memoryAnalysisAgentConfig?.model),
        provider: Boolean(systemAgent?.memoryAnalysisAgentConfig?.provider),
      },
      layerExtractor: {
        model: Boolean(systemAgent?.memoryAnalysisAgentConfig?.model),
        provider: Boolean(systemAgent?.memoryAnalysisAgentConfig?.provider),
      },
    },
  };
}

export async function getAiProviderRuntimeState(
  ctx: MemoryExtractionExecutorContext,
  userId: string,
  workspaceId?: string,
): Promise<AiProviderRuntimeState> {
  const db = await ctx.db;
  const aiInfraRepos = new AiInfraRepos(db, userId, ctx.aiProviderConfig, workspaceId);

  return getUserScopedAiProviderRuntimeState(
    userId,
    () => aiInfraRepos.getAiProviderRuntimeState(KeyVaultsGateKeeper.getUserKeyVaults),
    { throwOnUnresolvedAccess: true },
  );
}

export async function resolveRuntimeKeyVaults(
  ctx: MemoryExtractionExecutorContext,
  runtimeState: AiProviderRuntimeState,
  memoryServiceConfig: ResolvedMemoryServiceConfig,
): Promise<ProviderKeyVaultMap> {
  const normalizedRuntimeConfig = Object.fromEntries(
    Object.entries(runtimeState.runtimeConfig || {}).map(([providerId, config]) => [
      normalizeProvider(providerId),
      config,
    ]),
  );

  const keyVaults: ProviderKeyVaultMap = {};

  const gatekeeperProvider = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
    fallbackProvider: memoryServiceConfig.agents.gatekeeper.provider,
    label: 'gatekeeper',
    modelId: memoryServiceConfig.modelConfig.gateModel,
    preferredModels: memoryServiceConfig.overrides.gatekeeper.model
      ? undefined
      : ctx.gatekeeperPreferredModels,
    preferredProviders: memoryServiceConfig.overrides.gatekeeper.provider
      ? undefined
      : ctx.gatekeeperPreferredProviders,
  });
  const gatekeeperRuntime = normalizedRuntimeConfig[gatekeeperProvider];
  if (gatekeeperRuntime?.keyVaults) {
    keyVaults[gatekeeperProvider] = gatekeeperRuntime.keyVaults;
  }

  const embeddingProvider = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
    fallbackProvider: memoryServiceConfig.agents.embedding.provider,
    label: 'embedding',
    modelId: memoryServiceConfig.modelConfig.embeddingsModel,
    preferredModels: memoryServiceConfig.overrides.embedding.model
      ? undefined
      : ctx.embeddingPreferredModels,
    preferredProviders: memoryServiceConfig.overrides.embedding.provider
      ? undefined
      : ctx.embeddingPreferredProviders,
  });
  const embeddingRuntime = normalizedRuntimeConfig[embeddingProvider];
  if (embeddingRuntime?.keyVaults) {
    keyVaults[embeddingProvider] = embeddingRuntime.keyVaults;
  }

  for (const model of Object.values(memoryServiceConfig.modelConfig.layerModels)) {
    if (!model) continue;
    const providerId = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
      fallbackProvider: memoryServiceConfig.agents.layerExtractor.provider,
      label: 'layer extractor',
      modelId: model,
      preferredModels: memoryServiceConfig.overrides.layerExtractor.model
        ? undefined
        : ctx.layerPreferredModels,
      preferredProviders: memoryServiceConfig.overrides.layerExtractor.provider
        ? undefined
        : ctx.layerPreferredProviders,
    });
    const runtime = normalizedRuntimeConfig[providerId];
    if (runtime?.keyVaults) {
      keyVaults[providerId] = runtime.keyVaults;
    }
  }

  return keyVaults;
}

export async function getRuntime(
  ctx: MemoryExtractionExecutorContext,
  userId: string,
  memoryServiceConfig: ResolvedMemoryServiceConfig,
  keyVaults?: ProviderKeyVaultMap,
): Promise<RuntimeBundle> {
  // TODO: implement a better cache eviction strategy
  // TODO: make cache size configurable
  if (ctx.runtimeCache.keys.length > 200) {
    ctx.runtimeCache.clear();
  }

  const cacheKey = [
    userId,
    memoryServiceConfig.agents.embedding.provider,
    memoryServiceConfig.agents.gatekeeper.provider,
    memoryServiceConfig.agents.layerExtractor.provider,
  ].join(':');
  const cached = ctx.runtimeCache.get(cacheKey);
  if (cached) return cached;

  const embeddingOptions: RuntimeResolveOptions = {
    fallback: {
      apiKey: memoryServiceConfig.agents.embedding.apiKey,
      baseURL: memoryServiceConfig.agents.embedding.baseURL,
    },
    preferred: {
      providerIds: memoryServiceConfig.overrides.embedding.provider
        ? undefined
        : ctx.embeddingPreferredProviders,
    },
    userId,
  };

  const gatekeeperOptions: RuntimeResolveOptions = {
    fallback: {
      apiKey: memoryServiceConfig.agents.gatekeeper.apiKey,
      baseURL: memoryServiceConfig.agents.gatekeeper.baseURL,
    },
    preferred: {
      providerIds: memoryServiceConfig.overrides.gatekeeper.provider
        ? undefined
        : ctx.gatekeeperPreferredProviders,
    },
    userId,
  };

  const layerExtractorOptions: RuntimeResolveOptions = {
    fallback: {
      apiKey: memoryServiceConfig.agents.layerExtractor.apiKey,
      baseURL: memoryServiceConfig.agents.layerExtractor.baseURL,
    },
    preferred: {
      providerIds: memoryServiceConfig.overrides.layerExtractor.provider
        ? undefined
        : ctx.layerPreferredProviders,
    },
    userId,
  };

  const hooks = getBusinessModelRuntimeHooks(userId, 'lobehub');

  const runtimes: RuntimeBundle = {
    embeddings: await resolveRuntimeAgentConfig(
      memoryServiceConfig.agents.embedding,
      keyVaults,
      embeddingOptions,
      hooks,
    ),
    gatekeeper: await resolveRuntimeAgentConfig(
      memoryServiceConfig.agents.gatekeeper,
      keyVaults,
      gatekeeperOptions,
      hooks,
    ),
    layerExtractor: await resolveRuntimeAgentConfig(
      memoryServiceConfig.agents.layerExtractor,
      keyVaults,
      layerExtractorOptions,
      hooks,
    ),
  };

  ctx.runtimeCache.set(cacheKey, runtimes);

  return runtimes;
}
