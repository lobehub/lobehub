/**
 * Model Name Resolver Utilities
 *
 * Helper functions for resolving model names to configurations
 * Contains all model lookup and query functions
 */
import debug from 'debug';

import {
  MODEL_ID_VARIANT_MAP,
  MODEL_REGISTRY,
  type ModelConfig,
} from '@/server/services/comfyui/config/modelRegistry';

const log = debug('lobe-image:comfyui:static-model-lookup');

/**
 * Resolve a model name to its configuration
 * This is a helper function for static model config lookup
 */
// ===================================================================
// Model Query Functions
// ===================================================================

/**
 * Get models by variant, sorted by priority
 */
export function getModelsByVariant(variant: ModelConfig['variant']): string[] {
  const matchingModels: Array<{ fileName: string; priority: number }> = [];

  for (const [fileName, config] of Object.entries(MODEL_REGISTRY)) {
    if (config.variant === variant) {
      matchingModels.push({ fileName, priority: config.priority });
    }
  }

  // Sort by priority (lower number = higher priority)
  return matchingModels.sort((a, b) => a.priority - b.priority).map((item) => item.fileName);
}

/**
 * Get single model config
 */
export function getModelConfig(
  modelName: string,
  options?: {
    caseInsensitive?: boolean;
    modelFamily?: ModelConfig['modelFamily'];
    priority?: number;
    recommendedDtype?: ModelConfig['recommendedDtype'];
    variant?: ModelConfig['variant'];
  },
): ModelConfig | undefined {
  // Direct lookup - KISS principle
  let config = MODEL_REGISTRY[modelName];

  // If not found and case-insensitive search requested, try case-insensitive lookup
  if (!config && options?.caseInsensitive) {
    const lowerModelName = modelName.toLowerCase();
    for (const [registryName, registryConfig] of Object.entries(MODEL_REGISTRY)) {
      if (registryName.toLowerCase() === lowerModelName) {
        config = registryConfig;
        break;
      }
    }
  }

  if (!config) return undefined;

  // No filters - return the config
  if (!options) return config;

  // Check filters (excluding caseInsensitive which is not a model property filter)
  const matches =
    (!options.variant || config.variant === options.variant) &&
    (!options.priority || config.priority === options.priority) &&
    (!options.modelFamily || config.modelFamily === options.modelFamily) &&
    (!options.recommendedDtype || config.recommendedDtype === options.recommendedDtype);

  return matches ? config : undefined;
}

/**
 * Get all model names from the registry
 * @returns Array of all model filenames
 */
export function getAllModelNames(): string[] {
  return Object.keys(MODEL_REGISTRY);
}

// ===================================================================
// Resolver Function
// ===================================================================

export function resolveModel(modelName: string): ModelConfig | null {
  log('Resolving static model config for:', modelName);

  // Clean the model name
  const cleanName = modelName.replace(/^comfyui\//, '');

  // First try exact match with filename
  let config = getModelConfig(cleanName);
  if (config) {
    return config;
  }

  // Try case-insensitive match
  config = getModelConfig(cleanName, { caseInsensitive: true });
  if (config) {
    return config;
  }

  // Try to resolve using model ID mapping
  const mappedVariant = MODEL_ID_VARIANT_MAP[cleanName];
  if (mappedVariant) {
    // Find first model with this variant
    for (const [, modelConfig] of Object.entries(MODEL_REGISTRY)) {
      if (modelConfig.variant === mappedVariant) {
        return modelConfig;
      }
    }
  }

  // Fallback: Try to match by variant name (legacy logic)
  for (const [, modelConfig] of Object.entries(MODEL_REGISTRY)) {
    // Check if clean name matches variant exactly or ends with variant
    if (
      cleanName === modelConfig.variant ||
      cleanName.endsWith(`-${modelConfig.variant}`) ||
      cleanName.endsWith(modelConfig.variant)
    ) {
      return modelConfig;
    }
  }

  log('No static config found for:', modelName);
  return null;
}
