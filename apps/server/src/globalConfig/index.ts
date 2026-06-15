import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { ModelProvider } from 'model-bank';

import { composioEnv } from '@/config/composio';
import { isDesktop } from '@/const/version';
import { appEnv, getAppConfig } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { fileEnv } from '@/envs/file';
import { imageEnv } from '@/envs/image';
import { knowledgeEnv } from '@/envs/knowledge';
import { langfuseEnv } from '@/envs/langfuse';
import { toolsEnv } from '@/envs/tools';
import { parseSSOProviders } from '@/libs/better-auth/utils/server';
import { parseSystemAgent } from '@/server/globalConfig/parseSystemAgent';
import { type GlobalServerConfig } from '@/types/serverConfig';
import { cleanObject } from '@/utils/object';

import {
  genServerAiProvidersConfig,
  type ProviderSpecificConfig,
} from './genServerAiProviderConfig';
import { parseAgentConfig } from './parseDefaultAgent';
import { parseFilesConfig } from './parseFilesConfig';
import { getPublicMemoryExtractionConfig } from './parseMemoryExtractionConfig';

/**
 * Get Better-Auth SSO providers list
 * Parses AUTH_SSO_PROVIDERS and returns enabled providers
 */
const getBetterAuthSSOProviders = () => {
  return parseSSOProviders(authEnv.AUTH_SSO_PROVIDERS);
};

export const getServerGlobalConfig = async () => {
  const { DEFAULT_AGENT_CONFIG } = getAppConfig();

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
      fetchOnClient: isDesktop ? false : undefined,
    },
    ollama: {
      enabled: isDesktop ? true : undefined,
      fetchOnClient: isDesktop ? false : !process.env.OLLAMA_PROXY_URL,
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

  const config: GlobalServerConfig = {
    aiProvider: await genServerAiProvidersConfig(aiProviderSpecificConfig),
    defaultAgent: {
      config: parseAgentConfig(DEFAULT_AGENT_CONFIG),
    },
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
    enableVisualUnderstanding: !!(
      toolsEnv.VISUAL_UNDERSTANDING_PROVIDER && toolsEnv.VISUAL_UNDERSTANDING_MODEL
    ),
    ...(toolsEnv.VISUAL_UNDERSTANDING_PROVIDER && toolsEnv.VISUAL_UNDERSTANDING_MODEL
      ? {
          visualUnderstanding: {
            model: toolsEnv.VISUAL_UNDERSTANDING_MODEL,
            provider: toolsEnv.VISUAL_UNDERSTANDING_PROVIDER,
          },
        }
      : undefined),

    // Expose Agent Gateway URL to client (used by hetero agents; also required for queue mode)
    ...(appEnv.AGENT_GATEWAY_URL ? { agentGatewayUrl: appEnv.AGENT_GATEWAY_URL } : undefined),

    image: cleanObject({
      defaultImageNum: imageEnv.AI_IMAGE_DEFAULT_IMAGE_NUM,
    }),
    memory: {
      userMemory: cleanObject(getPublicMemoryExtractionConfig()),
    },
    oAuthSSOProviders: getBetterAuthSSOProviders(),
    systemAgent: parseSystemAgent(appEnv.SYSTEM_AGENT),
    telemetry: {
      langfuse: langfuseEnv.ENABLE_LANGFUSE,
    },
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
