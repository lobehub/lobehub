import { resolveModel } from './staticModelLookup';

/**
 * FLUX Model Weight Dtype Selection Tool
 *
 * @description Automatic weight type selection: prioritize ModelNameStandardizer recommendations, return 'default' for unknown models
 *
 * @param {string} modelName - Model filename or path
 * @returns {string} Weight type string
 */
export function selectOptimalWeightDtype(modelName: string): string {
  const config = resolveModel(modelName);
  if (!config) {
    return 'default';
  }
  return config.recommendedDtype || 'default';
}
