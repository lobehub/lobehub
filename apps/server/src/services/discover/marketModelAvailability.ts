import { BRANDING_PROVIDER, ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { isLobeHubModelAvailable } from '@lobechat/business-model-bank/model-config';

type MarketModel =
  string | { model?: string; parameters?: Record<string, unknown>; provider?: string };

interface MarketModelCarrier {
  model?: MarketModel | null;
  params?: Record<string, unknown>;
  provider?: string | null;
}

/**
 * A Market agent version keeps the model its author published with. Once that official model is
 * retired or disabled, installing or forking the agent would copy a model no channel serves, and
 * every run fails. Drop such a model so the installed agent follows the default model instead.
 *
 * Only official-provider models (also the provider a bare model id resolves to) are judged; beta
 * models are judged for the reading user. Parameters the model object carried move into `params`,
 * where both install paths read them, and the config's own `params` keep priority.
 */
export const withoutUnavailableModel = async <T extends MarketModelCarrier>(
  config: T | null | undefined,
  userEmail: string | undefined,
): Promise<T | null | undefined> => {
  if (!ENABLE_BUSINESS_FEATURES || !config?.model) return config;

  const model = config.model;
  const id = typeof model === 'string' ? model : model.model;
  const provider = (typeof model === 'object' ? model.provider : undefined) ?? config.provider;
  if (!id || (provider && provider !== BRANDING_PROVIDER)) return config;
  if (await isLobeHubModelAvailable(id, 'chat', { userEmail })) return config;

  const { model: _model, provider: _provider, ...rest } = config;
  const parameters = typeof model === 'object' ? model.parameters : undefined;
  return (parameters ? { ...rest, params: { ...parameters, ...config.params } } : rest) as T;
};
