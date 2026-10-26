import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { parseToolNameMaxLength } from '@lobechat/const/plugin';
import { ModelProvider } from 'model-bank';
import urlJoin from 'url-join';

import { loadModels } from '@/business/client/model-bank/loadModels';
import { composioEnv } from '@/config/composio';
import { isDesktop } from '@/const/version';
import { appEnv, getAppConfig } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { fileEnv } from '@/envs/file';
import { gatewayEnv } from '@/envs/gateway';
import { imageEnv } from '@/envs/image';
import { knowledgeEnv } from '@/envs/knowledge';
import { langfuseEnv } from '@/envs/langfuse';
import { toolsEnv } from '@/envs/tools';
import { parseSSOProviders } from '@/libs/better-auth/utils/server';
import { OIDC_ISSUER_PATH } from '@/libs/oidc-provider/routes';
import { parseSystemAgent } from '@/server/globalConfig/parseSystemAgent';
import { isLlmRelayDeploymentReady } from '@/server/modules/AgentRuntime/llmRelay/deployment';
import { type GlobalServerConfig } from '@/types/serverConfig';
import { cleanObject } from '@/utils/object';

import {
  genServerAiProvidersConfig,
  type ProviderSpecificConfig,
} from './genServerAiProviderConfig';
import { parseAgentConfig } from './parseDefaultAgent';
import { parseFilesConfig } from './parseFilesConfig';
import { getPublicMemoryExtractionConfig } from './parseMemoryExtractionConfig';
import { getServerFetchOnClientOverride } from './serverFetchOnClient';

/**
 * Get Better-Auth SSO providers list
 * Parses AUTH_SSO_PROVIDERS and returns enabled providers
 */
const getBetterAuthSSOProviders = () => {
  return parseSSOProviders(authEnv.AUTH_SSO_PROVIDERS);
};

/**
 * Which Agent Gateway wire protocol the client may dial.
 *
 * The multiplexed `/v2/ws` socket only exists on the gateway that ships with
 * business builds. A self-hosted deployment runs `lobehub/lobehub-gateway`,
 * which serves `GET /ws` and nothing else — a client that picks v2 there only
 * reaches a working socket after burning its dial budget on 404s, so the
 * default has to be the one that works everywhere. `AGENT_GATEWAY_PROTOCOL`
 * overrides both guesses, which is what an on-prem business deployment sitting
 * in front of a v1 gateway needs.
 */
const resolveAgentGatewayProtocol = (): 1 | 2 => {
  if (appEnv.AGENT_GATEWAY_PROTOCOL === 2) return 2;
  if (appEnv.AGENT_GATEWAY_PROTOCOL === 1) return 1;

  return ENABLE_BUSINESS_FEATURES ? 2 : 1;
};

const getAiProviderSpecificConfig = () => {
  const aiProviderSpecificConfig: Record<string, ProviderSpecificConfig> = {
    azure: {
      enabledKey: 'ENABLED_AZURE_OPENAI',
      withDeploymentName: true,
    },
    azureai: {
      withDeploymentName: true,
    },
    bedrock: {
      enabledKey: 'ENABLED_AWS_BEDROCK',
      modelListKey: 'AWS_BEDROCK_MODEL_LIST',
    },
    deepseek: {
      enabled: true,
    },
    giteeai: {
      enabledKey: 'ENABLED_GITEE_AI',
      modelListKey: 'GITEE_AI_MODEL_LIST',
    },
    kimicodingplan: {
      withDeploymentName: true,
    },
    lmstudio: {
      fetchOnClient: getServerFetchOnClientOverride('lmstudio'),
    },
    ollama: {
      enabled: isDesktop ? true : undefined,
      fetchOnClient: getServerFetchOnClientOverride('ollama'),
    },
    ollamacloud: {
      enabledKey: 'ENABLED_OLLAMA_CLOUD',
    },
    qwen: {
      withDeploymentName: true,
    },
    spark: {
      withDeploymentName: true,
    },
    tencentcloud: {
      enabledKey: 'ENABLED_TENCENT_CLOUD',
      modelListKey: 'TENCENT_CLOUD_MODEL_LIST',
    },
    unsloth: {
      fetchOnClient: getServerFetchOnClientOverride('unsloth'),
    },
    volcengine: {
      withDeploymentName: true,
    },
    volcenginecodingplan: {
      withDeploymentName: true,
    },
  };

  // In business feature mode, keep the built-in provider as the only default-enabled
  // provider while preserving provider-specific metadata such as fetch/model-list keys.
  // Non-business builds keep the upstream defaults.
  if (ENABLE_BUSINESS_FEATURES) {
    for (const provider of Object.values(ModelProvider)) {
      aiProviderSpecificConfig[provider] = {
        ...aiProviderSpecificConfig[provider],
        enabled: provider === ModelProvider.LobeHub,
      };
    }
  }

  return aiProviderSpecificConfig;
};

/** Resolve one provider without rebuilding the global config or reloading its catalog. */
export const getServerAiProviderConfig = async (provider: ModelProvider) => {
  const models = await loadModels();
  const configs = await genServerAiProvidersConfig(
    getAiProviderSpecificConfig(),
    [provider],
    models,
  );
  const config = configs[provider];

  return {
    ...config,
    serverModelLists:
      config.serverModelLists ?? models.filter((model) => model.providerId === provider),
  };
};

export const getServerGlobalConfig = async () => {
  const { DEFAULT_AGENT_CONFIG } = getAppConfig();

  const config: GlobalServerConfig = {
    aiProvider: await genServerAiProvidersConfig(getAiProviderSpecificConfig()),
    defaultAgent: {
      config: parseAgentConfig(DEFAULT_AGENT_CONFIG),
    },
    deviceGatewayConfigured: !!gatewayEnv.DEVICE_GATEWAY_URL,
    // Never fall back to the server-internal DEVICE_GATEWAY_URL.
    ...(gatewayEnv.DEVICE_GATEWAY_PUBLIC_URL
      ? { deviceGatewayUrl: gatewayEnv.DEVICE_GATEWAY_PUBLIC_URL }
      : undefined),
    disableEmailPassword: authEnv.AUTH_DISABLE_EMAIL_PASSWORD,
    enableBusinessFeatures: ENABLE_BUSINESS_FEATURES,
    enableEmailVerification: authEnv.AUTH_EMAIL_VERIFICATION,
    enableComposio: !!composioEnv.COMPOSIO_API_KEY,
    enableGatewayMode:
      ENABLE_BUSINESS_FEATURES || (!!appEnv.ENABLE_AGENT_GATEWAY && !!appEnv.AGENT_GATEWAY_URL),
    enableLobehubSkill: !!(appEnv.MARKET_TRUSTED_CLIENT_SECRET && appEnv.MARKET_TRUSTED_CLIENT_ID),
    enableMagicLink: authEnv.AUTH_ENABLE_MAGIC_LINK,
    enableMarketTrustedClient: !!(
      appEnv.MARKET_TRUSTED_CLIENT_SECRET && appEnv.MARKET_TRUSTED_CLIENT_ID
    ),
    enableUploadFileToServer: !!fileEnv.S3_SECRET_ACCESS_KEY,
    enableMultimodalUnderstanding: !!(
      toolsEnv.MULTIMODAL_UNDERSTANDING_PROVIDER && toolsEnv.MULTIMODAL_UNDERSTANDING_MODEL
    ),
    ...(toolsEnv.MULTIMODAL_UNDERSTANDING_PROVIDER && toolsEnv.MULTIMODAL_UNDERSTANDING_MODEL
      ? {
          multimodalUnderstanding: {
            model: toolsEnv.MULTIMODAL_UNDERSTANDING_MODEL,
            provider: toolsEnv.MULTIMODAL_UNDERSTANDING_PROVIDER,
          },
        }
      : undefined),

    // Expose Agent Gateway URL to client (used by hetero agents; also required for queue mode)
    ...(appEnv.AGENT_GATEWAY_URL ? { agentGatewayUrl: appEnv.AGENT_GATEWAY_URL } : undefined),
    agentGatewayProtocol: resolveAgentGatewayProtocol(),
    // Whether the server can relay an LLM call to a tab (gateway + Redis): only
    // then does the browser drop its own provider fallback for the one-shot relay.
    llmRelayAvailable: isLlmRelayDeploymentReady(),

    image: cleanObject({
      defaultImageNum: imageEnv.AI_IMAGE_DEFAULT_IMAGE_NUM,
    }),
    memory: {
      userMemory: cleanObject(getPublicMemoryExtractionConfig()),
    },
    oAuthSSOProviders: getBetterAuthSSOProviders(),
    // Same derivation as the provider's own issuer (`libs/oidc-provider/provider.ts`).
    ...(appEnv.APP_URL ? { oidcIssuer: urlJoin(appEnv.APP_URL, OIDC_ISSUER_PATH) } : undefined),
    systemAgent: parseSystemAgent(appEnv.SYSTEM_AGENT),
    telemetry: {
      langfuse: langfuseEnv.ENABLE_LANGFUSE,
    },
    // The client-driven chat path generates tool names in the browser, so the
    // server-only `TOOL_NAME_MAX_LENGTH` has to travel with the config for `0`
    // (compression off) to have any effect outside gateway mode. Parsed with the
    // resolver's own function so both sides read the raw value identically —
    // unset/invalid stays `undefined`, i.e. the resolver's default 64.
    toolNameMaxLength: parseToolNameMaxLength(toolsEnv.TOOL_NAME_MAX_LENGTH),
  };

  return config;
};

export const getServerDefaultAgentConfig = () => {
  const { DEFAULT_AGENT_CONFIG } = getAppConfig();

  return parseAgentConfig(DEFAULT_AGENT_CONFIG) || {};
};

export const getServerDefaultFilesConfig = () => {
  return parseFilesConfig(knowledgeEnv.DEFAULT_FILES_CONFIG);
};
