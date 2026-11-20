import {
  getModelParameters,
  getModelPricing,
  getVideoOutputTokenParamNames,
  getVideoPricingParamNames,
} from '@lobechat/model-runtime';
import type { VideoModelParamsSchema } from 'model-bank';

/**
 * Fill request params the price depends on (e.g. `duration`, `resolution`) from the model card
 * defaults. Callers such as agent tools may omit them; the provider would then generate with its
 * own default while billing could not see it, so the request is made explicit before pricing.
 */
export const fillVideoPricingDefaults = async <T extends Record<string, unknown>>(params: {
  model: string;
  params: T;
  provider: string;
}): Promise<T> => {
  const { model, provider } = params;
  const names = [
    ...new Set([
      ...getVideoPricingParamNames(await getModelPricing(model, provider)),
      ...getVideoOutputTokenParamNames(model),
    ]),
  ];
  if (names.length === 0) return params.params;

  const schema = (await getModelParameters(model, provider)) as VideoModelParamsSchema | undefined;
  const filled: Record<string, unknown> = { ...params.params };
  for (const name of names) {
    const defaultValue = (schema?.[name as keyof VideoModelParamsSchema] as { default?: unknown })
      ?.default;
    if (filled[name] == null && defaultValue != null) filled[name] = defaultValue;
  }

  return filled as T;
};
