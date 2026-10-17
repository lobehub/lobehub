import { CREDITS_PER_DOLLAR, USD_TO_CNY } from '@lobechat/const/currency';
import debug from 'debug';
import type {
  FixedPricingUnit,
  LookupPricingUnit,
  Pricing,
  PricingUnit,
  PricingUnitName,
  PricingUnitType,
  TieredPricingUnit,
} from 'model-bank';

const log = debug('lobe-cost:computeVideoCost');

export interface VideoGenerationParams {
  [key: string]: unknown;
  /** Requested output duration in seconds, required by per-second pricing */
  duration?: number;
  generateAudio?: boolean;
  resolution?: string;
}

/**
 * Request inputs that cannot be read from the params alone and are metered before the request
 * (e.g. by reading the reference images' dimensions).
 */
export interface VideoRequestPricingInputs {
  /**
   * Output-token estimate used only to size the hold when the output size follows an input image
   * (see `meterVideoOutputTokens`); never charged as is
   */
  estimatedOutputTokens?: number;
  /** Output video tokens, known before the request when the output size follows the params */
  outputTokens?: number;
  /** Reference-image tokens, counted by {@link countVideoReferenceImageTokens} */
  referenceImageTokens?: number;
}

export interface VideoRequestCostItem {
  cost: number;
  lookupKey?: string;
  name: PricingUnitName;
  quantity: number;
  unit: PricingUnitType;
}

export interface VideoCostResult {
  breakdown?: {
    completionTokens: number;
    /** Billed output seconds, set when the model is priced per second */
    durationSeconds?: number;
    lookupKey?: string;
    pricePerMillionTokens?: number;
    pricePerSecond?: number;
    /** Every pricing unit priced from the request, set by {@link computeVideoRequestCost} */
    units?: VideoRequestCostItem[];
  };
  totalCost: number; // Total cost in USD
  totalCredits: number; // Total credits (USD * CREDITS_PER_DOLLAR)
}

const toUSD = (cost: number, currency: string) => (currency === 'CNY' ? cost / USD_TO_CNY : cost);

const resolveLookupRate = (
  unit: LookupPricingUnit,
  params: VideoGenerationParams,
): { lookupKey: string; rate: number } | undefined => {
  if (!unit.lookup?.pricingParams) {
    log('No pricing params defined for lookup strategy');
    return undefined;
  }

  const lookupParams: string[] = [];
  for (const paramName of unit.lookup.pricingParams) {
    const paramValue = params[paramName];
    if (paramValue === undefined || paramValue === null) {
      log(`Missing required lookup param: ${paramName}`);
      return undefined;
    }
    lookupParams.push(String(paramValue));
  }

  const lookupKey = lookupParams.join('_');
  const rate = unit.lookup.prices?.[lookupKey];
  if (typeof rate !== 'number') {
    log(`No price found for lookup key: ${lookupKey}`);
    return undefined;
  }

  return { lookupKey, rate };
};

const toImageUrl = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

/**
 * Reference images a request sends. Models that take both frames and references (MiniMax H3,
 * fal H3 Max) fold the first/last frames into the reference pool once references are present,
 * so pricing and the runtimes must agree on this order.
 */
export const getVideoReferenceImages = (params: {
  [key: string]: unknown;
  endImageUrl?: unknown;
  imageUrl?: unknown;
  imageUrls?: unknown;
}): string[] => {
  const references = Array.isArray(params.imageUrls)
    ? params.imageUrls.map(toImageUrl).filter((url): url is string => !!url)
    : [];
  if (references.length === 0) return [];

  return [toImageUrl(params.imageUrl), ...references, toImageUrl(params.endImageUrl)].filter(
    (url): url is string => !!url,
  );
};

const countReferenceImages = (params: VideoGenerationParams) =>
  getVideoReferenceImages(params).length;

/**
 * Request params the pricing reads. A request must carry them explicitly: when one is missing the
 * provider applies its own default, which the price cannot see.
 */
export const getVideoPricingParamNames = (pricing?: Pricing): string[] => {
  const names = new Set<string>();
  for (const unit of pricing?.units ?? []) {
    if (unit.name === 'videoGeneration' && unit.unit === 'second') names.add('duration');
    if (unit.strategy === 'lookup') unit.lookup.pricingParams?.forEach((name) => names.add(name));
  }
  return [...names];
};

/**
 * Whether the pricing bills reference images by token, so callers must meter
 * `referenceImageTokens` from the images before pricing the request.
 */
export const needsVideoReferenceImageTokens = (pricing?: Pricing): boolean =>
  !!pricing?.units.some((unit) => unit.name === 'imageInput' && unit.unit === 'millionTokens');

/**
 * The quantity a pricing unit bills, known from the request alone. `undefined` means the quantity
 * only exists after generation (e.g. output video tokens), so the request cannot be priced exactly.
 */
const resolveRequestQuantity = (
  unit: PricingUnit,
  params: VideoGenerationParams,
  inputs: VideoRequestPricingInputs,
): number | undefined => {
  switch (`${unit.name}:${unit.unit}`) {
    case 'videoGeneration:second': {
      const duration = Number(params.duration);
      return Number.isFinite(duration) && duration > 0 ? duration : undefined;
    }
    case 'videoGeneration:video': {
      return 1;
    }
    case 'videoGeneration:millionTokens': {
      return inputs.outputTokens;
    }
    case 'imageInput:image': {
      return countReferenceImages(params);
    }
    case 'imageInput:millionTokens': {
      if (countReferenceImages(params) === 0) return 0;
      return inputs.referenceImageTokens;
    }
    default: {
      return undefined;
    }
  }
};

/** Price of `quantity` under `rate`, where token units are rated per million */
const toUnitCost = (unit: PricingUnit, rate: number, quantity: number) =>
  unit.unit === 'millionTokens' ? (rate * quantity) / 1_000_000 : rate * quantity;

const computeTieredCost = (unit: TieredPricingUnit, quantity: number): number | undefined => {
  if (unit.mode !== 'graduated') {
    const tier = unit.tiers.find(({ upTo }) => upTo === 'infinity' || quantity <= (upTo as number));
    return tier ? toUnitCost(unit, tier.rate, quantity) : undefined;
  }

  let cost = 0;
  let lowerBound = 0;
  for (const tier of unit.tiers) {
    const upperBound = tier.upTo === 'infinity' ? Number.POSITIVE_INFINITY : tier.upTo;
    const inTier = Math.min(quantity, upperBound) - lowerBound;
    if (inTier > 0) cost += toUnitCost(unit, tier.rate, inTier);
    if (quantity <= upperBound) return cost;
    lowerBound = upperBound;
  }

  // Tiers end before the quantity does: the remainder has no configured rate.
  return undefined;
};

/**
 * Price a video request before it runs. Returns a result only when every pricing unit's quantity
 * is known from the request (see {@link resolveRequestQuantity}) and priced; that result is the
 * exact charge, e.g. fal H3 Max bills requested seconds plus reference tokens above an allowance.
 * `undefined` means the cost depends on provider-reported usage (e.g. output video tokens), so the
 * caller holds an approximate price and settles on completion instead.
 */
export const computeVideoRequestCost = (
  pricing: Pricing,
  params: VideoGenerationParams,
  inputs: VideoRequestPricingInputs = {},
): VideoCostResult | undefined => {
  if (pricing.units.length === 0) return undefined;

  const units: VideoRequestCostItem[] = [];
  for (const unit of pricing.units) {
    const quantity = resolveRequestQuantity(unit, params, inputs);
    if (quantity === undefined) {
      log('Unit %s:%s is not known before the request', unit.name, unit.unit);
      return undefined;
    }

    let cost: number | undefined;
    let lookupKey: string | undefined;
    switch (unit.strategy) {
      case 'fixed': {
        cost = toUnitCost(unit, unit.rate, quantity);
        break;
      }
      case 'lookup': {
        const resolved = resolveLookupRate(unit, params);
        if (resolved) {
          lookupKey = resolved.lookupKey;
          cost = toUnitCost(unit, resolved.rate, quantity);
        }
        break;
      }
      case 'tiered': {
        cost = computeTieredCost(unit, quantity);
        break;
      }
    }

    if (cost === undefined) {
      log('Unit %s:%s cannot be priced from the request', unit.name, unit.unit);
      return undefined;
    }
    units.push({ cost, lookupKey, name: unit.name, quantity, unit: unit.unit });
  }

  const currency = pricing.currency || 'USD';
  const costInUSD = toUSD(
    units.reduce((sum, item) => sum + item.cost, 0),
    currency,
  );
  const outputUnit = units.find(
    (item) => item.name === 'videoGeneration' && item.unit === 'second',
  );
  log('Video request cost: $%d USD, units: %O', costInUSD, units);

  return {
    breakdown: {
      completionTokens: 0,
      durationSeconds: outputUnit?.quantity,
      lookupKey: outputUnit?.lookupKey,
      pricePerSecond: outputUnit ? outputUnit.cost / outputUnit.quantity : undefined,
      units,
    },
    totalCost: costInUSD,
    totalCredits: Math.ceil(costInUSD * CREDITS_PER_DOLLAR),
  };
};

/**
 * Compute the cost for video generation based on pricing configuration.
 * Supports both fixed and lookup pricing strategies; units not rated per token (e.g. per second)
 * are priced from the request by {@link computeVideoRequestCost} and ignore `completionTokens`.
 * Handles CNY→USD conversion when pricing currency is CNY.
 */
export const computeVideoCost = (
  pricing: Pricing,
  completionTokens: number,
  params: VideoGenerationParams,
): VideoCostResult | undefined => {
  const videoGenUnit = pricing.units.find((unit) => unit.name === 'videoGeneration');
  if (!videoGenUnit) {
    log('No videoGeneration unit found in pricing configuration');
    return undefined;
  }

  if (videoGenUnit.unit !== 'millionTokens') return computeVideoRequestCost(pricing, params);

  const currency = pricing.currency || 'USD';
  let pricePerMillionTokens: number;
  let lookupKey: string | undefined;

  switch (videoGenUnit.strategy) {
    case 'fixed': {
      const fixedUnit = videoGenUnit as FixedPricingUnit;
      if (fixedUnit.unit !== 'millionTokens') {
        log(`Unsupported unit type for fixed pricing: ${fixedUnit.unit}`);
        return undefined;
      }
      pricePerMillionTokens = fixedUnit.rate;
      log(`Fixed pricing: ${pricePerMillionTokens} per million tokens (${currency})`);
      break;
    }
    case 'lookup': {
      const resolved = resolveLookupRate(videoGenUnit as LookupPricingUnit, params);
      if (!resolved) return undefined;

      ({ lookupKey, rate: pricePerMillionTokens } = resolved);
      log(
        `Lookup pricing for key "${lookupKey}": ${pricePerMillionTokens} per million tokens (${currency})`,
      );
      break;
    }
    default: {
      log(`Unsupported pricing strategy: ${videoGenUnit.strategy}`);
      return undefined;
    }
  }

  // Calculate cost in original currency
  const costInCurrency = (pricePerMillionTokens * completionTokens) / 1_000_000;

  // Convert to USD if needed
  const costInUSD = toUSD(costInCurrency, currency);
  const totalCredits = Math.ceil(costInUSD * CREDITS_PER_DOLLAR);

  log(
    `Video cost: %d tokens × %d/%s per million = %d %s = $%d USD (%d credits)`,
    completionTokens,
    pricePerMillionTokens,
    currency,
    costInCurrency,
    currency,
    costInUSD,
    totalCredits,
  );

  return {
    breakdown: {
      completionTokens,
      lookupKey,
      pricePerMillionTokens,
    },
    totalCost: costInUSD,
    totalCredits,
  };
};
