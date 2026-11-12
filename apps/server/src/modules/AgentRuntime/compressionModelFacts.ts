import { getModelPropertyWithFallback } from '@lobechat/model-runtime';
import type { CompressionModelFacts } from '@lobechat/types';
import type { LobeDefaultAiModelListItem } from 'model-bank';

/**
 * The window and ratio automatic compression measures against. A window the
 * user set on their own model row (a custom model, or a builtin they edited)
 * wins over the catalog, so such models no longer fall back to the 128k
 * default. The ratio only comes from the model-bank card. Reads no database:
 * the caller passes the row's window and, when it already holds it, the bank.
 */
export const buildCompressionModelFacts = async (
  model: string,
  provider: string,
  userWindow?: number | null,
  catalog?: LobeDefaultAiModelListItem[],
): Promise<CompressionModelFacts> => {
  const [bankWindow, bankRatio] = await Promise.all([
    getModelPropertyWithFallback<number | undefined>(
      model,
      'contextWindowTokens',
      provider,
      catalog,
    ),
    getModelPropertyWithFallback<number | undefined>(
      model,
      'compressionThresholdRatio',
      provider,
      catalog,
    ),
  ]);

  return {
    maxWindowToken: typeof userWindow === 'number' && userWindow > 0 ? userWindow : bankWindow,
    modelThresholdRatio: bankRatio,
  };
};
