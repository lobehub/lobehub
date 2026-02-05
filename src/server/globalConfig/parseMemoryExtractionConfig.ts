import { DEFAULT_MINI_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MINI_MODEL, DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM } from '@lobechat/const';

import type {GlobalMemoryExtractionConfig, GlobalMemoryLayer, MemoryAgentPublicConfig, MemoryLayerExtractorPublicConfig} from '@/types/serverConfig';

const MEMORY_LAYERS: GlobalMemoryLayer[] = [
  'activity',
  'context',
  'experience',
  'identity',
  'preference',
];

const parseTokenLimitEnv = (value?: string) => {
  if (value === undefined) return undefined;
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;

  return Math.floor(parsed);
};

export type MemoryAgentConfig = MemoryAgentPublicConfig & {
  apiKey?: string;
  language?: string;
  model: string;
};

export type MemoryLayerExtractorConfig = MemoryLayerExtractorPublicConfig &
  MemoryAgentConfig & {
    layers: Record<GlobalMemoryLayer, string>;
  };

export interface MemoryExtractionPrivateConfig {
  agentGateKeeper: MemoryAgentConfig;
  agentGateKeeperPreferredModels?: string[];
  agentGateKeeperPreferredProviders?: string[];
  agentLayerExtractor: MemoryLayerExtractorConfig;
  agentLayerExtractorPreferredModels?: string[];
  agentLayerExtractorPreferredProviders?: string[];
  agentPersonaWriter: MemoryAgentConfig;
  concurrency?: number;
  embedding: MemoryAgentConfig;
  embeddingPreferredModels?: string[];
  embeddingPreferredProviders?: string[];
  featureFlags: {
    enableBenchmarkLoCoMo: boolean;
  };
  observabilityS3?: {
    accessKeyId?: string;
    bucketName?: string;
    enabled: boolean;
    endpoint?: string;
    forcePathStyle?: boolean;
    pathPrefix?: string;
    region?: string;
    secretAccessKey?: string;
  };
  upstashWorkflowExtraHeaders?: Record<string, string>;
  webhook: {
    baseUrl?: string;
    headers?: Record<string, string>;
  };
  whitelistUsers?: string[];
}

const parseGateKeeperAgent = (): MemoryAgentConfig => {
  const apiKey = process.env.MEMORY_USER_MEMORY_GATEKEEPER_API_KEY;
  const baseURL = process.env.MEMORY_USER_MEMORY_GATEKEEPER_BASE_URL;
  const model = process.env.MEMORY_USER_MEMORY_GATEKEEPER_MODEL || DEFAULT_MINI_MODEL;
  const provider = process.env.MEMORY_USER_MEMORY_GATEKEEPER_PROVIDER || DEFAULT_MINI_PROVIDER;
  const language = process.env.MEMORY_USER_MEMORY_GATEKEEPER_LANGUAGE || 'English';

  return {
    apiKey,
    baseURL,
    language,
    model,
    provider,
  };
};

const parseLayerExtractorAgent = (fallbackModel: string): MemoryLayerExtractorConfig => {
  const apiKey = process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_API_KEY;
  const baseURL = process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_BASE_URL;
  const model = process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_MODEL || fallbackModel;
  const provider = process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_PROVIDER || DEFAULT_MINI_PROVIDER;
  const contextLimit = parseTokenLimitEnv(
    process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_CONTEXT_LIMIT,
  );

  const layers = MEMORY_LAYERS.reduce<Record<GlobalMemoryLayer, string>>(
    (acc, layer) => {
      const envKey = `MEMORY_USER_MEMORY_LAYER_EXTRACTOR_${layer.toUpperCase()}_MODEL`;
      const override = (process.env as Record<string, string | undefined>)[envKey];
      acc[layer] = override || model;

      return acc;
    },
    {} as Record<GlobalMemoryLayer, string>,
  );

  return {
    apiKey,
    baseURL,
    contextLimit,
    layers,
    model,
    provider,
  };
};

const parseEmbeddingAgent = (
  fallbackModel: string,
  fallbackProvider: string,
  fallbackApiKey?: string,
): MemoryAgentConfig => {
  const { model: defaultModel, provider: defaultProvider } =
    DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM;
  const model = process.env.MEMORY_USER_MEMORY_EMBEDDING_MODEL || fallbackModel || defaultModel;
  const provider =
    process.env.MEMORY_USER_MEMORY_EMBEDDING_PROVIDER ||
    fallbackProvider ||
    defaultProvider ||
    DEFAULT_MINI_PROVIDER;

  return {
    apiKey: process.env.MEMORY_USER_MEMORY_EMBEDDING_API_KEY ?? fallbackApiKey,
    baseURL: process.env.MEMORY_USER_MEMORY_EMBEDDING_BASE_URL,
    contextLimit: parseTokenLimitEnv(process.env.MEMORY_USER_MEMORY_EMBEDDING_CONTEXT_LIMIT),
    model,
    provider,
  };
};

const parsePersonaWriterAgent = (
  fallbackModel: string,
  fallbackProvider?: string,
  fallbackApiKey?: string,
): MemoryAgentConfig => {
  const model = process.env.MEMORY_USER_MEMORY_PERSONA_WRITER_MODEL || fallbackModel;
  const provider =
    process.env.MEMORY_USER_MEMORY_PERSONA_WRITER_PROVIDER ||
    fallbackProvider ||
    DEFAULT_MINI_PROVIDER;

  return {
    apiKey: process.env.MEMORY_USER_MEMORY_PERSONA_WRITER_API_KEY ?? fallbackApiKey,
    baseURL: process.env.MEMORY_USER_MEMORY_PERSONA_WRITER_BASE_URL,
    contextLimit: parseTokenLimitEnv(process.env.MEMORY_USER_MEMORY_PERSONA_WRITER_CONTEXT_LIMIT),
    model,
    provider,
  };
};

const parseExtractorAgentObservabilityS3 = () => {
  const accessKeyId = process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_SECRET_ACCESS_KEY;
  const bucketName = process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_BUCKET_NAME;
  const region = process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_REGION;
  const endpoint = process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_ENDPOINT;
  const forcePathStyle = process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_FORCE_PATH_STYLE === 'true';
  const pathPrefix = process.env.MEMORY_USER_MEMORY_EXTRACTOR_S3_PATH_PREFIX;

  if (!accessKeyId || !secretAccessKey || !endpoint) {
    return {
      enabled: false,
    };
  }

  return {
    accessKeyId,
    bucketName,
    enabled: true,
    endpoint,
    forcePathStyle,
    pathPrefix,
    region,
    secretAccessKey,
  };
};

const sanitizeAgent = (agent?: MemoryAgentConfig): MemoryAgentPublicConfig | undefined => {
  if (!agent) return undefined;
  const sanitized: MemoryAgentConfig = { ...agent };
  delete sanitized.apiKey;

  return sanitized as MemoryAgentPublicConfig;
};

const parsePreferredList = (value?: string) =>
  value
    ?.split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

export const parseMemoryExtractionConfig = (): MemoryExtractionPrivateConfig => {
  const agentGateKeeper = parseGateKeeperAgent();
  const agentLayerExtractor = parseLayerExtractorAgent(agentGateKeeper.model);
  const agentPersonaWriter = parsePersonaWriterAgent(agentGateKeeper.model);
  const embedding = parseEmbeddingAgent(
    agentLayerExtractor.model,
    agentLayerExtractor.provider || DEFAULT_MINI_PROVIDER,
    agentGateKeeper.apiKey || agentLayerExtractor.apiKey,
  );
  const extractorObservabilityS3 = parseExtractorAgentObservabilityS3();
  const featureFlags = {
    enableBenchmarkLoCoMo: process.env.MEMORY_USER_MEMORY_FEATURE_FLAG_BENCHMARK_LOCOMO === 'true',
  };
  const concurrencyRaw = process.env.MEMORY_USER_MEMORY_CONCURRENCY;
  const concurrency =
    concurrencyRaw !== undefined
      ? Number.isInteger(Number(concurrencyRaw)) && Number(concurrencyRaw) > 0
        ? Number(concurrencyRaw)
        : undefined
      : undefined;

  const whitelistUsers = process.env.MEMORY_USER_MEMORY_WHITELIST_USERS?.split(',')
    .filter(Boolean)
    .map((s) => s.trim());

  const webhookHeaders = process.env.MEMORY_USER_MEMORY_WEBHOOK_HEADERS?.split(',')
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, pair) => {
      const [key, value] = pair.split('=').map((s) => s.trim());
      if (key && value) {
        acc[key] = value;
      }
      return acc;
    }, {});

  const upstashWorkflowExtraHeaders = process.env.MEMORY_USER_MEMORY_WORKFLOW_EXTRA_HEADERS?.split(
    ',',
  )
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, pair) => {
      const [key, value] = pair.split('=').map((s) => s.trim());
      if (key && value) {
        acc[key] = value;
      }
      return acc;
    }, {});

  const agentGateKeeperPreferredProviders = parsePreferredList(
    process.env.MEMORY_USER_MEMORY_GATEKEEPER_PREFERRED_PROVIDERS,
  );
  const agentGateKeeperPreferredModels = parsePreferredList(
    process.env.MEMORY_USER_MEMORY_GATEKEEPER_PREFERRED_MODELS,
  );
  const embeddingPreferredProviders = parsePreferredList(
    process.env.MEMORY_USER_MEMORY_EMBEDDING_PREFERRED_PROVIDERS,
  );
  const embeddingPreferredModels = parsePreferredList(
    process.env.MEMORY_USER_MEMORY_EMBEDDING_PREFERRED_MODELS,
  );
  const agentLayerExtractorPreferredProviders = parsePreferredList(
    process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_PREFERRED_PROVIDERS,
  );
  const agentLayerExtractorPreferredModels = parsePreferredList(
    process.env.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_PREFERRED_MODELS,
  );

  return {
    agentGateKeeper,
    agentGateKeeperPreferredModels,
    agentGateKeeperPreferredProviders,
    agentLayerExtractor,
    agentLayerExtractorPreferredModels,
    agentLayerExtractorPreferredProviders,
    agentPersonaWriter,
    concurrency,
    embedding,
    embeddingPreferredModels,
    embeddingPreferredProviders,
    featureFlags,
    observabilityS3: extractorObservabilityS3,
    upstashWorkflowExtraHeaders,
    webhook: {
      baseUrl: process.env.MEMORY_USER_MEMORY_WEBHOOK_BASE_URL,
      headers: webhookHeaders,
    },
    whitelistUsers,
  };
};

export const getPublicMemoryExtractionConfig = (): GlobalMemoryExtractionConfig => {
  const privateConfig = parseMemoryExtractionConfig();

  return {
    agentGateKeeper: sanitizeAgent(privateConfig.agentGateKeeper)!,
    agentLayerExtractor: {
      ...sanitizeAgent(privateConfig.agentLayerExtractor),
      layers: privateConfig.agentLayerExtractor.layers,
    },
    concurrency: privateConfig.concurrency,
    embedding: sanitizeAgent(privateConfig.embedding),
  };
};
