import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { parseToolNameMaxLength } from '@lobechat/const/plugin';
import { currentTenantScope } from '@lobechat/database/tenant';
import { ModelProvider } from 'model-bank';

import { loadModels } from '@/business/client/model-bank/loadModels';
import { composioEnv } from '@/config/composio';
import { isDesktop } from '@/const/version';
import { appEnv, getAppConfig } from '@/envs/app';
import { fileEnv } from '@/envs/file';
import { gatewayEnv } from '@/envs/gateway';
import { imageEnv } from '@/envs/image';
import { langfuseEnv } from '@/envs/langfuse';
import { sandboxEnv } from '@/envs/sandbox';
import { toolsEnv } from '@/envs/tools';
import { OIDC_ISSUER_PATH } from '@/libs/oidc-provider/routes';
import { resolveMemoryServiceModelConfig } from '@/server/services/memory/userMemory/systemAgent';
import { type GlobalServerConfig } from '@/types/serverConfig';
import { cleanObject } from '@/utils/object';

import {
  genServerAiProvidersConfig,
  type ProviderSpecificConfig,
} from './genServerAiProviderConfig';
import { getLoginMethods } from './loginMethods';
import { parseAgentConfig } from './parseDefaultAgent';
import { getPublicMemoryExtractionConfig } from './parseMemoryExtractionConfig';
import { getServerFetchOnClientOverride } from './serverFetchOnClient';
import { getServerSystemModels } from './systemModels';

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

  const tenant = currentTenantScope();
  const systemModels = await getServerSystemModels();
  const loginMethods = await getLoginMethods();
  const config: GlobalServerConfig = {
    aiProvider: await genServerAiProvidersConfig(getAiProviderSpecificConfig()),
    ...(appEnv.APP_URL ? { appUrl: appEnv.APP_URL.replace(/\/+$/, '') } : undefined),
    defaultAgent: {
      config: parseAgentConfig(DEFAULT_AGENT_CONFIG),
    },
    deviceGatewayConfigured: !!gatewayEnv.DEVICE_GATEWAY_URL,
    // Never fall back to the server-internal DEVICE_GATEWAY_URL.
    ...(gatewayEnv.DEVICE_GATEWAY_PUBLIC_URL
      ? { deviceGatewayUrl: gatewayEnv.DEVICE_GATEWAY_PUBLIC_URL }
      : undefined),
    disableEmailPassword: !loginMethods.emailPassword,
    enableBusinessFeatures: ENABLE_BUSINESS_FEATURES,
    enableEmailVerification: loginMethods.requireEmailVerification,
    enableComposio: !!composioEnv.COMPOSIO_API_KEY,
    enableGatewayMode:
      ENABLE_BUSINESS_FEATURES || (!!appEnv.ENABLE_AGENT_GATEWAY && !!appEnv.AGENT_GATEWAY_URL),
    // The LobeHub Skill connectors (Notion/PostHog/GitHub/etc. OAuth) are a
    // hosted-cloud-only integration — private-label deployments can't complete
    // their OAuth handshake, so keep them hidden even if the market trusted-
    // client env vars happen to be set for other reasons. The Skill Store
    // marketplace and cloud sandbox are unaffected — separate feature, no
    // dependency on these env vars.
    enableLobehubSkill:
      !ENABLE_BUSINESS_FEATURES &&
      !!(appEnv.MARKET_TRUSTED_CLIENT_SECRET && appEnv.MARKET_TRUSTED_CLIENT_ID),
    enableMagicLink: loginMethods.magicLink,
    enableMarketTrustedClient: !!(
      appEnv.MARKET_TRUSTED_CLIENT_SECRET && appEnv.MARKET_TRUSTED_CLIENT_ID
    ),
    enableUploadFileToServer: !!fileEnv.S3_SECRET_ACCESS_KEY,
    enableMultimodalUnderstanding: !!systemModels.multimodalUnderstanding,
    ...(systemModels.multimodalUnderstanding
      ? {
          multimodalUnderstanding: {
            model: systemModels.multimodalUnderstanding.model,
            provider: systemModels.multimodalUnderstanding.provider,
          },
        }
      : undefined),

    // Expose Agent Gateway URL to client (used by hetero agents; also required for queue mode)
    ...(appEnv.AGENT_GATEWAY_URL ? { agentGatewayUrl: appEnv.AGENT_GATEWAY_URL } : undefined),
    agentGatewayProtocol: resolveAgentGatewayProtocol(),
    // Whether the server can relay an LLM call to a tab (gateway + Redis): only
    // then does the browser drop its own provider fallback for the one-shot relay.
    llmRelayAvailable: false,

    // Where this deployment serves its own installers. Omitted entirely when
    // none are configured, so the client can tell "we publish builds" from
    // "we publish none" without a second flag.
    ...(appEnv.DESKTOP_DOWNLOAD_URL_MACOS || appEnv.DESKTOP_DOWNLOAD_URL_WINDOWS
      ? {
          desktopDownloads: cleanObject({
            macOS: appEnv.DESKTOP_DOWNLOAD_URL_MACOS,
            windows: appEnv.DESKTOP_DOWNLOAD_URL_WINDOWS,
          }),
        }
      : undefined),

    image: cleanObject({
      defaultImageNum: imageEnv.AI_IMAGE_DEFAULT_IMAGE_NUM,
    }),
    memory: {
      userMemory: cleanObject(
        getPublicMemoryExtractionConfig(await resolveMemoryServiceModelConfig()),
      ),
    },
    // SSO providers belong to a tenant (`sso_providers`, spec A8): the auth
    // config endpoint lists the ones of the tenant being signed in to.
    oAuthSSOProviders: [],
    ...(appEnv.APP_URL && tenant
      ? {
          oidcIssuer: `${tenant.endpoint.publicUrl}${OIDC_ISSUER_PATH}`,
        }
      : undefined),
    systemAgent: systemModels.systemAgent,
    telemetry: {
      langfuse: langfuseEnv.ENABLE_LANGFUSE,
    },
    // The client-driven chat path generates tool names in the browser, so the
    // server-only `TOOL_NAME_MAX_LENGTH` has to travel with the config for `0`
    // (compression off) to have any effect outside gateway mode. Parsed with the
    // resolver's own function so both sides read the raw value identically —
    // unset/invalid stays `undefined`, i.e. the resolver's default 64.
    toolNameMaxLength: parseToolNameMaxLength(toolsEnv.TOOL_NAME_MAX_LENGTH),
    // Same reason as `toolNameMaxLength` immediately above: without this, a
    // white-label deployment's `BUILTIN_TOOL_ID_NAMESPACE` would only take
    // effect in gateway (server-run) mode, and the browser-generated tool
    // names on the client-driven chat path would still say `lobe-*`.
    toolIdNamespace: toolsEnv.BUILTIN_TOOL_ID_NAMESPACE,
    // Lets the widget publish review match the sandbox's real egress contract:
    // unless the Worker enforces per-host allowlists, declared hosts are
    // advisory and the review must say any host is reachable.
    widgetSandboxNetworkFormat: sandboxEnv.WIDGET_SANDBOX_NETWORK_FORMAT,
  };

  return config;
};

export const getServerDefaultAgentConfig = () => {
  const { DEFAULT_AGENT_CONFIG } = getAppConfig();

  return parseAgentConfig(DEFAULT_AGENT_CONFIG) || {};
};

export const getServerDefaultFilesConfig = async () => {
  const { filesConfig } = await getServerSystemModels();

  return filesConfig;
};
