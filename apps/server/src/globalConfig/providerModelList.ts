import * as AiModels from 'model-bank';
import { type AiFullModelCard, type LobeDefaultAiModelListItem, ModelProvider } from 'model-bank';

export interface ProviderModelListOption {
  modelListKey?: string;
  withDeploymentName?: boolean;
}

/**
 * Providers whose `*_MODEL_LIST` env var uses a non-default key or carries
 * `id->deploymentName` mappings. Shared by server global config and runtime
 * capability lookups so both read the exact same env configuration.
 */
export const PROVIDER_MODEL_LIST_OPTIONS: Partial<Record<ModelProvider, ProviderModelListOption>> =
  {
    azure: { withDeploymentName: true },
    azureai: { withDeploymentName: true },
    bedrock: { modelListKey: 'AWS_BEDROCK_MODEL_LIST' },
    giteeai: { modelListKey: 'GITEE_AI_MODEL_LIST' },
    kimicodingplan: { withDeploymentName: true },
    qwen: { withDeploymentName: true },
    spark: { withDeploymentName: true },
    tencentcloud: { modelListKey: 'TENCENT_CLOUD_MODEL_LIST' },
    volcengine: { withDeploymentName: true },
    volcenginecodingplan: { withDeploymentName: true },
  };

const BUILTIN_MODEL_PROVIDERS = new Set<string>(Object.values(ModelProvider));

/**
 * Resolve env-configured `*_MODEL_LIST` model cards for a single provider,
 * reusing an already-loaded `builtinModels` snapshot.
 *
 * Returns `undefined` for custom providers or when no `*_MODEL_LIST` env var
 * is configured for `provider`.
 */
export const resolveServerProviderModelList = async (
  provider: string,
  builtinModels: LobeDefaultAiModelListItem[],
): Promise<AiFullModelCard[] | undefined> => {
  if (!BUILTIN_MODEL_PROVIDERS.has(provider)) return undefined;

  const option = PROVIDER_MODEL_LIST_OPTIONS[provider as ModelProvider];
  const modelListKey = option?.modelListKey ?? `${provider.toUpperCase()}_MODEL_LIST`;
  const modelString = process.env[modelListKey];
  if (!modelString) return undefined;

  const providerBuiltinModels = builtinModels.filter((model) => model.providerId === provider);
  const staticModels = AiModels as unknown as Record<string, AiFullModelCard[] | undefined>;
  const defaultModels =
    providerBuiltinModels.length > 0
      ? providerBuiltinModels
      : Object.hasOwn(staticModels, provider)
        ? (staticModels[provider] ?? [])
        : [];

  const { transformToAiModelList } = await import('@/utils/server/parseModels');

  return transformToAiModelList({
    builtinModels,
    defaultModels,
    modelString,
    providerId: provider,
    withDeploymentName: option?.withDeploymentName ?? false,
  });
};
