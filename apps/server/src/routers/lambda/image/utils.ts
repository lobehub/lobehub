import { getModelParameters, getModelPricing } from '@lobechat/model-runtime';

/**
 * Fill model-card parameter defaults into `generationParams` for parameters
 * required by lookup-based image pricing.
 *
 * Lookup pricing (e.g. `grok-imagine-image-2.0` priced by
 * `pricingParams: ['quality', 'resolution']`) requires every lookup param to
 * be present, otherwise `computeImageCost` returns `undefined` and the whole
 * request is rejected with `Unable to compute cost for model`. Client callers
 * may omit optional parameters, so before charging we backfill each missing
 * lookup param from the model card's parameter defaults — the same values the
 * upstream provider would apply anyway (xAI defaults to `medium`/`1k`).
 *
 * Non-lookup pricing and fully-absent model cards return the params untouched.
 *
 * Generic over the params object so required fields (e.g. `prompt`) survive
 * the round trip for callers; `null` lookup values are treated as missing,
 * matching `computeImageCost` which rejects both `null` and `undefined`.
 */
export const applyLookupPricingParamDefaults = async <T extends Record<string, unknown>>(
  generationParams: T,
  model: string,
  provider: string,
): Promise<T> => {
  let pricingParams: string[] | undefined;

  try {
    const pricing = await getModelPricing(model, provider);
    const lookupUnit = pricing?.units.find(
      (unit) => unit.name === 'imageGeneration' && unit.strategy === 'lookup',
    );
    pricingParams =
      lookupUnit && lookupUnit.strategy === 'lookup'
        ? lookupUnit.lookup?.pricingParams
        : undefined;
  } catch {
    // Pricing resolution is best-effort here: CostService will report a
    // precise error afterwards if the pricing really is unusable.
    return generationParams;
  }

  if (!pricingParams || pricingParams.length === 0) return generationParams;

  const missingParams = pricingParams.filter(
    (param) => generationParams[param] === undefined || generationParams[param] === null,
  );
  if (missingParams.length === 0) return generationParams;

  const parameters = (await getModelParameters(model, provider)) as
    | Record<string, { default?: unknown } | undefined>
    | undefined;
  if (!parameters) return generationParams;

  const updates: Record<string, unknown> = {};
  for (const param of missingParams) {
    const fallback = parameters[param]?.default;
    if (fallback !== undefined && fallback !== null) {
      updates[param] = fallback;
    }
  }

  return Object.keys(updates).length > 0 ? { ...generationParams, ...updates } : generationParams;
};

/**
 * Recursively validate that no full URLs are present in the config
 * This is a defensive check to ensure only keys are stored in database
 */
export function validateNoUrlsInConfig(obj: any, path: string = ''): void {
  if (typeof obj === 'string') {
    if (obj.startsWith('http://') || obj.startsWith('https://')) {
      throw new Error(
        `Invalid configuration: Found full URL instead of key at ${path || 'root'}. ` +
          `URL: "${obj.slice(0, 100)}${obj.length > 100 ? '...' : ''}". ` +
          `All URLs must be converted to storage keys before database insertion.`,
      );
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      validateNoUrlsInConfig(item, `${path}[${index}]`);
    });
  } else if (obj && typeof obj === 'object') {
    Object.entries(obj).forEach(([key, value]) => {
      const currentPath = path ? `${path}.${key}` : key;
      validateNoUrlsInConfig(value, currentPath);
    });
  }
}
