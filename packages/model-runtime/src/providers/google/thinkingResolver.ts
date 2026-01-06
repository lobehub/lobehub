/* eslint-disable sort-keys-fix/sort-keys-fix*/
/**
 * Google Gemini Thinking Resolver
 *
 * Resolves thinking configuration for Google Gemini models.
 * Uses regex patterns for model matching instead of hardcoded strings.
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
export type GoogleThinkingLevel = 'low' | 'high';

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

/**
 * Model category patterns - evaluated in order, first match wins
 */
const MODEL_CATEGORY_PATTERNS: Record<Exclude<GoogleThinkingModelCategory, 'other'>, RegExp[]> = {
  robotics: [/robotics-er-1\.5-preview/i],
  flashLite: [
    /gemini-\d+(?:\.\d+)?-flash-lite/i, // gemini-2.5-flash-lite, gemini-3.0-flash-lite
    /flash-lite-latest/i,
  ],
  flash: [
    /gemini-\d+(?:\.\d+)?-flash(?!-lite)/i, // gemini-2.5-flash, gemini-3.0-flash (but not flash-lite)
    /flash-latest/i,
  ],
  pro: [
    /gemini-\d+(?:\.\d+)?-pro/i, // gemini-2.5-pro, gemini-3.0-pro, gemini-3-pro
    /pro-latest/i,
  ],
};

/**
 * Models that inherently support/enable thinking
 * These models will have includeThoughts=true even without explicit thinkingBudget
 */
const THINKING_ENABLED_PATTERNS: RegExp[] = [
  /gemini-\d+(?:\.\d+)?-pro(?!-image)/i, // gemini-2.5-pro, gemini-3-pro (but not pro-image, handled separately)
  /gemini-\d+(?:\.\d+)?-flash(?!-lite)/i, // gemini-2.5-flash, gemini-3-flash (but not flash-lite)
  /gemini-\d+-pro-image/i, // gemini-3-pro-image-preview
  /nano-banana-pro/i,
  /thinking/i, // Any model with "thinking" in the name
];

/**
 * Patterns to detect Gemini 3.0+ models (which support thinkingLevel)
 */
const GEMINI_3_PATTERNS: RegExp[] = [
  /gemini-3(?:\.\d+)?-/i, // gemini-3-pro, gemini-3.0-flash
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Clamps a value to a range
 */
const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * Tests if a model matches any of the given patterns
 */
const matchesPatterns = (model: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(model));

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

  // Check categories in priority order
  const categoryOrder: Exclude<GoogleThinkingModelCategory, 'other'>[] = [
    'robotics',
    'flashLite',
    'flash',
    'pro',
  ];

  for (const category of categoryOrder) {
    if (matchesPatterns(model, MODEL_CATEGORY_PATTERNS[category])) {
      return category;
    }
  }

  return 'other';
};

/**
 * Checks if a model is a Gemini 3.0+ model (supports thinkingLevel)
 * @param model - The model identifier
 * @returns true if the model is Gemini 3.0+
 */
export const isGemini3Model = (model?: string): boolean => {
  if (!model) return false;
  return matchesPatterns(model, GEMINI_3_PATTERNS);
};

/**
 * Checks if a model inherently supports thinking (includeThoughts)
 * @param model - The model identifier
 * @returns true if the model inherently supports thinking
 */
export const isThinkingEnabledModel = (model?: string): boolean => {
  if (!model) return false;
  return matchesPatterns(model, THINKING_ENABLED_PATTERNS);
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
 * Determines if includeThoughts should be enabled
 */
const shouldIncludeThoughts = (
  model: string,
  options: GoogleThinkingResolverOptions,
  resolvedBudget: number | undefined,
): boolean | undefined => {
  const { thinkingBudget, thinkingLevel } = options;

  // Conditions that enable thinking:
  // 1. thinkingBudget is explicitly set (and not 0)
  // 2. thinkingLevel is explicitly set
  // 3. Model is in the thinking-enabled list
  const hasExplicitThinking = !!thinkingBudget || !!thinkingLevel;
  const isThinkingModel = isThinkingEnabledModel(model);

  // If thinking is requested AND budget is not 0, enable includeThoughts
  if ((hasExplicitThinking || isThinkingModel) && resolvedBudget !== 0) {
    return true;
  }

  return undefined;
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
