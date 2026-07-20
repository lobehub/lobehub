import { isGemini3OrAbove, parseGoogleModelId } from './modelId';

/**
 * Google Gemini Thinking Resolver
 *
 * Resolves thinking configuration for Google Gemini models.
 * Uses model-id parsing instead of hardcoded model strings.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Thinking model category for Google Gemini models
 * Different categories have different thinking budget constraints
 */
export type GoogleThinkingModelCategory = 'pro' | 'flash' | 'flashLite' | 'robotics' | 'other';

/**
 * Thinking level for Gemini 3.0+ models
 */
export type GoogleThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

/**
 * Options for resolving Google thinking configuration
 */
export interface GoogleThinkingResolverOptions {
  /** User-specified thinking budget (tokens) */
  thinkingBudget?: number | null;
  /** User-specified thinking level (for 3.0+ models) */
  thinkingLevel?: GoogleThinkingLevel;
}

/**
 * Resolved Google thinking configuration ready for API call
 */
export interface ResolvedGoogleThinkingConfig {
  /** Whether to include thoughts in the response */
  includeThoughts: boolean | undefined;
  /** Resolved thinking budget in tokens */
  thinkingBudget: number | undefined;
  /** Thinking level for 3.0+ models */
  thinkingLevel?: GoogleThinkingLevel;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Budget constraints for each model category
 */
const THINKING_BUDGET_CONSTRAINTS = {
  PRO_MIN: 128,
  PRO_MAX: 32_768,
  FLASH_MAX: 24_576,
  FLASH_LITE_MIN: 512,
  FLASH_LITE_MAX: 24_576,
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Clamps a value to a range
 */
const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const hasModifier = (model: string, modifier: string): boolean => {
  const parsed = parseGoogleModelId(model);
  return !!parsed && parsed.modifiers.includes(modifier);
};

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Determines the thinking model category for a Google Gemini model
 * @param model - The model identifier
 * @returns The category of the model
 */
export const getGoogleThinkingModelCategory = (model?: string): GoogleThinkingModelCategory => {
  if (!model) return 'other';

  if (/robotics-er-1\.5-preview/i.test(model)) return 'robotics';
  if (/flash-lite-latest/i.test(model)) return 'flashLite';
  if (/flash-latest/i.test(model)) return 'flash';
  if (/pro-latest/i.test(model)) return 'pro';

  const parsed = parseGoogleModelId(model);
  if (!parsed || parsed.family !== 'gemini') return 'other';
  if (parsed.majorVersion === undefined) return 'other';

  if (hasModifier(model, 'flash') && hasModifier(model, 'lite')) return 'flashLite';
  if (hasModifier(model, 'flash')) return 'flash';
  if (hasModifier(model, 'pro')) return 'pro';

  return 'other';
};

/**
 * Checks if a model is a Gemini 3.0+ model (supports thinkingLevel)
 * @param model - The model identifier
 * @returns true if the model is Gemini 3.0+
 */
export const isGemini3Model = (model?: string): boolean => {
  if (!model) return false;

  const parsed = parseGoogleModelId(model);

  return (
    isGemini3OrAbove(model) ||
    (parsed?.family === 'gemma' && parsed.majorVersion !== undefined && parsed.majorVersion >= 4)
  );
};

/**
 * Checks if a model inherently supports thinking (includeThoughts)
 * @param model - The model identifier
 * @returns true if the model inherently supports thinking
 */
export const isThinkingEnabledModel = (model?: string): boolean => {
  if (!model) return false;

  const normalizedModel = model.toLowerCase();
  if (normalizedModel.includes('thinking')) return true;

  const parsed = parseGoogleModelId(model);
  if (!parsed) return false;

  if (parsed.family === 'nanoBanana') return parsed.modifiers.includes('pro');
  if (parsed.family !== 'gemini') return false;
  if (parsed.majorVersion === undefined) return false;

  return (
    parsed.modifiers.includes('pro') ||
    (parsed.modifiers.includes('flash') && !parsed.modifiers.includes('lite'))
  );
};

/**
 * Resolves the thinking budget for a Google Gemini model
 *
 * @param model - The model identifier
 * @param thinkingBudget - User-specified thinking budget (tokens)
 * @returns Resolved thinking budget or undefined
 *
 * Special values:
 * - `-1`: Dynamic/unlimited thinking
 * - `0`: Thinking disabled
 */
export const resolveGoogleThinkingBudget = (
  model: string,
  thinkingBudget?: number | null,
): number | undefined => {
  const category = getGoogleThinkingModelCategory(model);
  const hasBudget = thinkingBudget !== undefined && thinkingBudget !== null;

  switch (category) {
    case 'pro': {
      // Pro models: 128-32768 tokens, default -1 (dynamic)
      if (!hasBudget) return -1;
      if (thinkingBudget === -1) return -1;
      return clamp(
        thinkingBudget,
        THINKING_BUDGET_CONSTRAINTS.PRO_MIN,
        THINKING_BUDGET_CONSTRAINTS.PRO_MAX,
      );
    }

    case 'flash': {
      // Flash models: 0-24576 tokens, supports 0 (disabled) and -1 (dynamic), default -1
      if (!hasBudget) return -1;
      if (thinkingBudget === -1 || thinkingBudget === 0) return thinkingBudget;
      return clamp(thinkingBudget, 0, THINKING_BUDGET_CONSTRAINTS.FLASH_MAX);
    }

    case 'flashLite':
    case 'robotics': {
      // FlashLite/Robotics: 512-24576 tokens, default 0 (disabled)
      if (!hasBudget) return 0;
      if (thinkingBudget === -1 || thinkingBudget === 0) return thinkingBudget;
      return clamp(
        thinkingBudget,
        THINKING_BUDGET_CONSTRAINTS.FLASH_LITE_MIN,
        THINKING_BUDGET_CONSTRAINTS.FLASH_LITE_MAX,
      );
    }

    default: {
      // Unknown models: no default, clamp to flash max if provided
      if (!hasBudget) return undefined;
      return Math.min(thinkingBudget, THINKING_BUDGET_CONSTRAINTS.FLASH_MAX);
    }
  }
};

/**
 * Determines if includeThoughts should be enabled.
 *
 * Vertex AI rejects includeThoughts:true when thinking is not actually
 * enabled, so we must only return true when thinking is genuinely active.
 */
const shouldIncludeThoughts = (
  model: string,
  options: GoogleThinkingResolverOptions,
  resolvedBudget: number | undefined,
): boolean | undefined => {
  const { thinkingBudget, thinkingLevel } = options;

  // 1. No thinking signal at all → not applicable
  if (!thinkingBudget && !thinkingLevel && !isThinkingEnabledModel(model)) return undefined;

  // 2. Budget resolved to a number → active only when non-zero
  if (typeof resolvedBudget === 'number') return resolvedBudget !== 0 ? true : undefined;

  // 3. Budget is undefined (Gemini 3 default / "other" category) →
  //    only thinkingLevel can activate thinking without a numeric budget
  return thinkingLevel ? true : undefined;
};

/**
 * Main resolver function - resolves complete Google thinking configuration
 *
 * IMPORTANT: thinkingBudget and thinkingLevel are mutually exclusive.
 * Gemini API returns error if both are set: "You can only set only one of thinking budget and thinking level."
 *
 * Priority rules:
 * 1. If thinkingLevel is set AND model is Gemini 3.0+, use thinkingLevel only
 * 2. Otherwise, use thinkingBudget only
 *
 * @param model - The model identifier
 * @param options - Thinking options from the payload
 * @returns Resolved thinking configuration
 *
 * @example
 * // Gemini 2.5 Pro with default dynamic thinking
 * resolveGoogleThinkingConfig('gemini-2.5-pro', {})
 * // Returns: { includeThoughts: true, thinkingBudget: -1 }
 *
 * @example
 * // Gemini 3.0 Pro with explicit thinking level (thinkingBudget is NOT included)
 * resolveGoogleThinkingConfig('gemini-3-pro-preview', { thinkingLevel: 'high' })
 * // Returns: { includeThoughts: true, thinkingLevel: 'high' }
 *
 * @example
 * // Gemini 2.5 Flash Lite with thinking disabled
 * resolveGoogleThinkingConfig('gemini-2.5-flash-lite', { thinkingBudget: 0 })
 * // Returns: { includeThoughts: undefined, thinkingBudget: 0 }
 */
export const resolveGoogleThinkingConfig = (
  model: string,
  options: GoogleThinkingResolverOptions = {},
): ResolvedGoogleThinkingConfig => {
  const { thinkingBudget, thinkingLevel } = options;

  const isGemini3 = isGemini3Model(model);
  const hasExplicitBudget = thinkingBudget !== undefined && thinkingBudget !== null;

  // IMPORTANT: thinkingBudget and thinkingLevel are mutually exclusive
  // Gemini API returns error if both are set

  // For Gemini 3.0+ models:
  // - If thinkingLevel is set, use thinkingLevel only
  // - If only thinkingBudget is set, use thinkingBudget (backwards compatible but suboptimal)
  // - If neither is set, don't set any thinking params (let API decide)
  if (isGemini3) {
    if (thinkingLevel) {
      const includeThoughts = shouldIncludeThoughts(model, options, undefined);
      return {
        includeThoughts,
        thinkingBudget: undefined,
        thinkingLevel,
      };
    }

    if (hasExplicitBudget) {
      const resolvedBudget = resolveGoogleThinkingBudget(model, thinkingBudget);
      const includeThoughts = shouldIncludeThoughts(model, options, resolvedBudget);
      return {
        includeThoughts,
        thinkingBudget: resolvedBudget,
      };
    }

    // Neither thinkingLevel nor thinkingBudget set - let API use default
    const includeThoughts = shouldIncludeThoughts(model, options, undefined);
    return {
      includeThoughts,
      thinkingBudget: undefined,
    };
  }

  // For Gemini 2.x and other models: use thinkingBudget (with defaults)
  const resolvedBudget = resolveGoogleThinkingBudget(model, thinkingBudget);
  const includeThoughts = shouldIncludeThoughts(model, options, resolvedBudget);

  return {
    includeThoughts,
    thinkingBudget: resolvedBudget,
  };
};
