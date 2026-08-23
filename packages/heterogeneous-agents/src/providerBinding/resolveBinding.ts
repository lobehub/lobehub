import type { LocalHeterogeneousAgentType } from '../config';
import type {
  HeterogeneousProviderBindingCapability,
  HeterogeneousProviderBindingError,
  HeterogeneousProviderBindingProtocol,
  ResolveHeterogeneousProviderBindingInput,
  ResolveHeterogeneousProviderBindingResult,
} from './types';

export const HETEROGENEOUS_PROVIDER_BINDING_AGENT_TYPES = ['claude-code', 'codex'] as const;

const CAPABILITIES: Partial<
  Record<LocalHeterogeneousAgentType, HeterogeneousProviderBindingCapability>
> = {
  'claude-code': {
    agentType: 'claude-code',
    protocols: ['anthropic-messages'],
  },
  'codex': {
    agentType: 'codex',
    protocols: ['openai-responses'],
  },
};

const nonEmptyString = (value: unknown): string | undefined => {
  const normalized = typeof value === 'string' ? value.trim() : undefined;
  return normalized || undefined;
};

const stripTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
};

const normalizeEndpoint = (value: unknown): string | undefined => {
  const raw = nonEmptyString(value);
  if (!raw) return;

  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return;
    // User info and query/hash values can contain credentials. They are not a
    // supported provider endpoint shape and must never reach profile files or metadata.
    if (url.username || url.password || url.search || url.hash) return;
    return stripTrailingSlashes(url.toString());
  } catch {
    return;
  }
};

export const getHeterogeneousProviderBindingCapability = (
  agentType: string | undefined,
): HeterogeneousProviderBindingCapability | undefined =>
  agentType ? CAPABILITIES[agentType as LocalHeterogeneousAgentType] : undefined;

export const isHeterogeneousProviderBindingSupported = (agentType: string | undefined): boolean =>
  !!getHeterogeneousProviderBindingCapability(agentType);

export const getProviderInferenceProtocols = (
  providerId: string,
  runtimeConfig: ResolveHeterogeneousProviderBindingInput['runtimeConfig'],
): HeterogeneousProviderBindingProtocol[] => {
  if (!runtimeConfig) return [];

  const sdkType = runtimeConfig.settings.sdkType ?? 'openai';
  if (sdkType === 'anthropic') return ['anthropic-messages'];
  if (sdkType === 'google') return ['google-generative-ai'];
  if (sdkType !== 'openai' && sdkType !== 'router') return [];

  const protocols: HeterogeneousProviderBindingProtocol[] = ['openai-chat-completions'];
  const responsesEnabled =
    runtimeConfig.config?.enableResponseApi ?? (providerId === 'openai' ? true : false);
  const responsesSupported =
    providerId === 'openai' || runtimeConfig.settings.supportResponsesApi === true;
  if (responsesEnabled && responsesSupported) protocols.unshift('openai-responses');
  return protocols;
};

export const resolveProviderBindingProtocol = (
  agentType: string,
  providerId: string,
  runtimeConfig: ResolveHeterogeneousProviderBindingInput['runtimeConfig'],
): HeterogeneousProviderBindingProtocol | undefined => {
  const capability = getHeterogeneousProviderBindingCapability(agentType);
  if (!capability) return;
  const providerProtocols = new Set(getProviderInferenceProtocols(providerId, runtimeConfig));
  return capability.protocols.find((protocol) => providerProtocols.has(protocol));
};

const resolveEndpointError = (
  providerId: string,
  rawEndpoint: unknown,
  protocol: HeterogeneousProviderBindingProtocol,
): { endpoint?: string; error?: HeterogeneousProviderBindingError } => {
  const raw = nonEmptyString(rawEndpoint);
  const endpoint = normalizeEndpoint(raw);
  if (raw && !endpoint) return { error: { code: 'endpointUnsupported', providerId } };

  if (protocol === 'openai-responses') {
    if (endpoint) return { endpoint };
    if (providerId === 'openai') return { endpoint: 'https://api.openai.com/v1' };
    return { error: { code: 'endpointMissing', providerId } };
  }

  return { endpoint };
};

export const resolveHeterogeneousProviderBinding = ({
  agentType,
  apiConfig,
  checkCredentials = false,
  enabledModels,
  providerEnabled,
  runtimeConfig,
}: ResolveHeterogeneousProviderBindingInput): ResolveHeterogeneousProviderBindingResult => {
  const capability = getHeterogeneousProviderBindingCapability(agentType);
  if (!capability) return { error: { agentType, code: 'agentUnsupported' } };

  if (!apiConfig?.providerId || !apiConfig.model?.trim())
    return { error: { code: 'configMissing' } };

  if (!providerEnabled || !runtimeConfig) {
    return { error: { code: 'providerUnavailable', providerId: apiConfig.providerId } };
  }

  const protocol = resolveProviderBindingProtocol(agentType, apiConfig.providerId, runtimeConfig);
  if (!protocol) {
    return {
      error: { agentType, code: 'protocolMismatch', providerId: apiConfig.providerId },
    };
  }

  if (runtimeConfig.settings.authType && runtimeConfig.settings.authType !== 'apiKey') {
    return { error: { code: 'credentialUnsupported', providerId: apiConfig.providerId } };
  }

  if (checkCredentials && !nonEmptyString(runtimeConfig.keyVaults?.apiKey)) {
    return { error: { code: 'credentialsMissing', providerId: apiConfig.providerId } };
  }

  const endpointResult = resolveEndpointError(
    apiConfig.providerId,
    runtimeConfig.keyVaults?.baseURL,
    protocol,
  );
  if (endpointResult.error) return { error: endpointResult.error };

  if (enabledModels) {
    const boundModels = [apiConfig.model, apiConfig.smallFastModel].filter(
      (model): model is string => !!model,
    );
    const unavailableModel = boundModels.find(
      (boundModel) =>
        !enabledModels.some(
          (model) =>
            model.providerId === apiConfig.providerId &&
            model.id === boundModel &&
            model.type === 'chat',
        ),
    );
    if (unavailableModel) {
      return {
        error: {
          code: 'modelUnavailable',
          model: unavailableModel,
          providerId: apiConfig.providerId,
        },
      };
    }
  }

  return {
    resolution: {
      agentType: capability.agentType,
      apiConfig: { ...apiConfig, model: apiConfig.model.trim() },
      endpoint: endpointResult.endpoint,
      protocol,
      providerId: apiConfig.providerId,
      runtimeConfig,
    },
  };
};

export const formatHeterogeneousProviderBindingError = (
  error: HeterogeneousProviderBindingError,
): string => {
  switch (error.code) {
    case 'agentUnsupported': {
      return `${error.agentType} does not support LobeHub Provider binding.`;
    }
    case 'configMissing': {
      return 'A provider and model binding is required.';
    }
    case 'credentialUnsupported': {
      return `Provider "${error.providerId}" uses an authentication scheme this agent does not support.`;
    }
    case 'credentialsMissing': {
      return `Provider "${error.providerId}" has no API key configured.`;
    }
    case 'endpointMissing': {
      return `Provider "${error.providerId}" requires a base URL for this agent.`;
    }
    case 'endpointUnsupported': {
      return `Provider "${error.providerId}" has an unsupported base URL.`;
    }
    case 'modelUnavailable': {
      return `Model "${error.providerId}/${error.model}" is disabled or unavailable.`;
    }
    case 'protocolMismatch': {
      return `Provider "${error.providerId}" does not expose a protocol supported by ${error.agentType}.`;
    }
    case 'providerUnavailable': {
      return `Provider "${error.providerId}" is disabled or unavailable.`;
    }
  }
};
