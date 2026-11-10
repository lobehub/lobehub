import { getModelPropertyWithFallback } from '@lobechat/model-runtime';
import debug from 'debug';

import { AiModelModel } from '@/database/models/aiModel';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-server:agent-runtime-service');

interface CompressionModelFactsDeps {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

/** The user's own row for this model, if any. A failed read only means "no row". */
const readUserModelRow = async (
  deps: CompressionModelFactsDeps,
  model: string,
  provider: string,
) => {
  try {
    return await new AiModelModel(deps.serverDB, deps.userId, deps.workspaceId).findByIdAndProvider(
      model,
      provider,
    );
  } catch (error) {
    // The catalog window still applies; one failed read must not fail the step.
    log('compression: failed to read the user model row: %O', error);
    return undefined;
  }
};

export interface CompressionModelFacts {
  /** The window the compression threshold is computed from. */
  maxWindowToken?: number;
  /** The model card's own share of the window that triggers compression. */
  modelThresholdRatio?: number;
}

/**
 * The window and ratio automatic compression measures against. A window the
 * user set on their own model row (a custom model, or a builtin they edited)
 * wins over the catalog, so such models no longer fall back to the 128k
 * default. The ratio only comes from the model-bank card.
 */
export const resolveCompressionModelFacts = async (
  deps: CompressionModelFactsDeps,
  model: string,
  provider: string,
): Promise<CompressionModelFacts> => {
  const [bankWindow, bankRatio, userModel] = await Promise.all([
    getModelPropertyWithFallback<number | undefined>(model, 'contextWindowTokens', provider),
    getModelPropertyWithFallback<number | undefined>(model, 'compressionThresholdRatio', provider),
    readUserModelRow(deps, model, provider),
  ]);

  const userWindow = userModel?.contextWindowTokens;

  return {
    maxWindowToken: typeof userWindow === 'number' && userWindow > 0 ? userWindow : bankWindow,
    modelThresholdRatio: bankRatio,
  };
};
