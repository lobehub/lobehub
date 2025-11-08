/* eslint-disable sort-keys-fix/sort-keys-fix */
import { CREDITS_PER_DOLLAR, USD_TO_CNY } from '@lobechat/const/currency';
import { ModelTokensUsage } from '@lobechat/types';
import debug from 'debug';
import {
  FixedPricingUnit,
  LookupPricingUnit,
  Pricing,
  PricingUnit,
  PricingUnitName,
  TieredPricingUnit,
} from 'model-bank';

const log = debug('lobe-cost:computeChatPricing');

export interface PricingUnitBreakdown {
  cost: number;
  credits: number;
  currency: string | 'USD' | 'CNY';
  /**
   * For lookup strategies we expose the resolved key.
   */
  lookupKey?: string;
  quantity: number;
  /**
   * Extra details for tiered strategies to help consumers render ladders.
   */
  segments?: Array<{ credits: number; quantity: number; rate: number }>;
  unit: PricingUnit;
}

export interface PricingComputationIssue {
  reason: string;
  unit: PricingUnit;
}

export interface ComputeChatCostOptions {
  /**
   * Input parameters used by lookup strategies (e.g. ttl, thinkingMode).
   */
  lookupParams?: Record<string, string | number | boolean>;
  /**
   * Exchange rate for CNY to USD conversion. Defaults to USD_TO_CNY constant.
   * Useful for testing with fixed exchange rates.
   */
  usdToCnyRate?: number;
}

export interface PricingComputationResult {
  breakdown: PricingUnitBreakdown[];
  issues: PricingComputationIssue[];
  totalCost: number;
  totalCredits: number;
}

type UnitQuantityResolver = (usage: ModelTokensUsage) => number | undefined;

const UNIT_QUANTITY_RESOLVERS: Partial<Record<PricingUnitName, UnitQuantityResolver>> = {
  textInput: (usage) => {
    if (usage.inputCacheMissTokens !== undefined) {
      return usage.inputCacheMissTokens;
    }

    if (typeof usage.inputCachedTokens === 'number' && typeof usage.totalInputTokens === 'number') {
      throw new Error(
        'Missing inputCacheMissTokens! You can set it by inputCacheMissTokens = totalInputTokens - inputCachedTokens',
      );
    }

    return usage.inputTextTokens ?? usage.totalInputTokens;
  },
  textInput_cacheRead: (usage) => usage.inputCachedTokens,
  textInput_cacheWrite: (usage) => usage.inputWriteCacheTokens,
  // reasoning tokens cost within output tokens
  textOutput: (usage) => {
    const { outputTextTokens, totalOutputTokens, outputReasoningTokens = 0 } = usage;
    const reasoningTokens = outputReasoningTokens;

    if (typeof outputTextTokens === 'number') {
      return outputTextTokens + reasoningTokens;
    }

    if (typeof totalOutputTokens === 'number') {
      return totalOutputTokens;
    }

    if (typeof usage.outputReasoningTokens === 'number') {
      return usage.outputReasoningTokens;
    }

    return undefined;
  },

  imageInput: (usage) => usage.inputImageTokens,
  imageInput_cacheRead: () => undefined,
  imageOutput: (usage) => usage.outputImageTokens,

  imageGeneration: () => undefined,

  audioInput: (usage) => usage.inputAudioTokens,
  // TODO: Support this when ModelTokensUsage includes this data
  audioInput_cacheRead: () => undefined,
  audioOutput: (usage) => usage.outputAudioTokens,
};

/**
 * Convert currency-specific credits to USD credits and ceil to integer
 * @param credits - Credits in the original currency
 * @param currency - The currency of the credits ('USD' or 'CNY')
 * @param usdToCnyRate - Exchange rate for CNY to USD conversion (defaults to USD_TO_CNY constant)
 * @returns USD-equivalent credits (ceiled to integer)
 */
const toUSDCredits = (
  credits: number,
  currency: string = 'USD',
  usdToCnyRate = USD_TO_CNY,
): number => {
  const usdCredits = currency === 'CNY' ? credits / usdToCnyRate : credits;
  return Math.ceil(usdCredits);
};

/**
 * Convert credits to USD dollar amount
 * @param credits - USD credits
 * @returns USD dollar amount
 */
const creditsToUSD = (credits: number) => credits / CREDITS_PER_DOLLAR;

/**
 * Returns raw credits, which will be rounded up uniformly at the final aggregation stage.
 */
const computeFixedCredits = (unit: FixedPricingUnit, quantity: number) => quantity * unit.rate;

/**
 * Google provider uses new pricing for entire input and output when exceeding threshold, not tiered calculation
 * TODO: Some providers do use tiered calculation, such as Zhipu
 */
const computeTieredCredits = (
  unit: TieredPricingUnit,
  quantity: number,
): { credits: number; segments: Array<{ credits: number; quantity: number; rate: number }> } => {
  if (quantity <= 0) return { credits: 0, segments: [] };

  const segments: Array<{ credits: number; quantity: number; rate: number }> = [];
  const tiers = unit.tiers ?? [];
  if (tiers.length === 0) return { credits: 0, segments };

  // Google and other providers charge the entire quantity at the new rate when exceeding threshold
  const matchedTier =
    tiers.find((tier) => {
      const limit = tier.upTo === 'infinity' ? Number.POSITIVE_INFINITY : tier.upTo;
      return quantity <= limit;
    }) ?? tiers.at(-1);

  if (!matchedTier) return { credits: 0, segments };

  const credits = quantity * matchedTier.rate;
  segments.push({ credits, quantity, rate: matchedTier.rate });

  return { credits, segments };
};

const resolveLookupKey = (
  unit: LookupPricingUnit,
  options: ComputeChatCostOptions | undefined,
): { key?: string; missingParams?: string[] } => {
  if (!unit.lookup?.pricingParams?.length) return { key: undefined };

  const missingParams: string[] = [];
  const params = unit.lookup.pricingParams.map((param) => {
    const source = options?.lookupParams?.[param];
    if (source === undefined || source === null) {
      missingParams.push(param);
      return 'undefined';
    }

    if (typeof source === 'boolean') return String(source);
    return String(source);
  });

  if (missingParams.length > 0) return { key: undefined, missingParams };

  return { key: params.join('_') };
};

const computeLookupCredits = (
  unit: LookupPricingUnit,
  quantity: number,
  options: ComputeChatCostOptions | undefined,
): { credits: number; issues?: PricingComputationIssue; key?: string } => {
  const { key, missingParams } = resolveLookupKey(unit, options);

  if (missingParams && missingParams.length > 0) {
    return {
      credits: 0,
      issues: {
        reason: `Missing lookup params: ${missingParams.join(', ')}`,
        unit,
      },
    };
  }

  if (!key) {
    return {
      credits: 0,
      issues: {
        reason: 'Lookup key could not be resolved',
        unit,
      },
    };
  }

  const lookupRate = unit.lookup.prices?.[key];
  if (typeof lookupRate !== 'number') {
    return {
      credits: 0,
      issues: {
        reason: `Lookup price not found for key "${key}"`,
        unit,
      },
      key,
    };
  }

  return {
    credits: quantity * lookupRate,
    key,
  };
};

const resolveQuantity = (unit: PricingUnit, usage: ModelTokensUsage) => {
  const resolver = UNIT_QUANTITY_RESOLVERS[unit.name as PricingUnitName];
  const quantity = resolver?.(usage);
  return typeof quantity === 'number' ? quantity : undefined;
};

/**
 * 1. Keep raw credits for each item (may be decimal)
 * 2. Round up uniformly at the totals stage to prevent cost undercounting
 */
export const computeChatCost = (
  pricing: Pricing | undefined,
  usage: ModelTokensUsage,
  options?: ComputeChatCostOptions,
): PricingComputationResult | undefined => {
  if (!pricing) return undefined;

  const breakdown: PricingUnitBreakdown[] = [];
  const issues: PricingComputationIssue[] = [];
  const currency = pricing.currency || 'USD';
  const usdToCnyRate = options?.usdToCnyRate ?? USD_TO_CNY;

  for (const unit of pricing.units) {
    const quantity = resolveQuantity(unit, usage);
    if (quantity === undefined) continue;

    if (unit.strategy === 'fixed') {
      if (unit.unit !== 'millionTokens')
        throw new Error(`Unsupported chat pricing unit: ${unit.unit}`);

      const fixedUnit = unit as FixedPricingUnit;
      const rawCredits = computeFixedCredits(fixedUnit, quantity);
      const usdCredits = toUSDCredits(rawCredits, currency, usdToCnyRate);
      breakdown.push({
        cost: creditsToUSD(usdCredits),
        credits: usdCredits,
        quantity,
        currency,
        unit,
      });
      continue;
    }

    if (unit.strategy === 'tiered') {
      const tieredUnit = unit as TieredPricingUnit;
      const { credits: rawCredits, segments } = computeTieredCredits(tieredUnit, quantity);
      const usdCredits = toUSDCredits(rawCredits, currency, usdToCnyRate);
      breakdown.push({
        cost: creditsToUSD(usdCredits),
        credits: usdCredits,
        quantity,
        currency,
        segments,
        unit,
      });
      continue;
    }

    if (unit.strategy === 'lookup') {
      const lookupUnit = unit as LookupPricingUnit;
      const {
        credits: rawCredits,
        key,
        issues: lookupIssue,
      } = computeLookupCredits(lookupUnit, quantity, options);

      if (lookupIssue) issues.push(lookupIssue);

      const usdCredits = toUSDCredits(rawCredits, currency, usdToCnyRate);
      breakdown.push({
        cost: creditsToUSD(usdCredits),
        credits: usdCredits,
        lookupKey: key,
        quantity,
        currency,
        unit,
      });
      continue;
    }

    issues.push({ reason: 'Unsupported pricing strategy', unit });
  }

  // Sum up USD credits from all breakdown items
  const rawTotalCredits = breakdown.reduce((sum, item) => sum + item.credits, 0);
  const totalCredits = Math.ceil(rawTotalCredits);
  // !: totalCredits has been uniformly rounded up to integer USD credits, divided by CREDITS_PER_DOLLAR naturally retains only 6 decimal places, no additional processing needed
  const totalCost = creditsToUSD(totalCredits);

  log(`computeChatPricing breakdown: ${JSON.stringify(breakdown, null, 2)}`);

  return {
    breakdown,
    issues,
    totalCost,
    totalCredits,
  };
};
