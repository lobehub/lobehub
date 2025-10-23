import { resolveModel } from './staticModelLookup';

/**
 * FLUX 模型权重类型选择工具 / FLUX Model Weight Dtype Selection Tool
 *
 * @description 自动选择模型权重类型：优先使用ModelNameStandardizer推荐值，未知模型返回'default'
 * Automatic weight type selection: prioritize ModelNameStandardizer recommendations, return 'default' for unknown models
 *
 * @param {string} modelName - 模型文件名或路径 / Model filename or path
 * @returns {string} 权重类型字符串 / Weight type string
 */
export function selectOptimalWeightDtype(modelName: string): string {
  const config = resolveModel(modelName);
  if (!config) {
    return 'default';
  }
  return config.recommendedDtype || 'default';
}
