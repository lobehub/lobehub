import type { CompressionModelFacts, FrozenModelFacts } from '@lobechat/types';
import debug from 'debug';

import { AiModelModel } from '@/database/models/aiModel';
import type { LobeChatDatabase } from '@/database/type';
import { buildCompressionModelFacts } from '@/server/modules/AgentRuntime/compressionModelFacts';

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

/**
 * The compression facts for one step. The operation froze them with the rest
 * of its model facts when it was created, so every step and retry reuses that
 * snapshot instead of querying the user's model row again. Another model (a
 * compression model), or an operation whose snapshot lacks them, resolves live.
 */
export const resolveCompressionModelFacts = async (
  deps: CompressionModelFactsDeps,
  model: string,
  provider: string,
  frozen?: FrozenModelFacts,
): Promise<CompressionModelFacts> => {
  if (frozen?.compression && frozen.model === model && frozen.provider === provider) {
    return frozen.compression;
  }

  const userModel = await readUserModelRow(deps, model, provider);
  return buildCompressionModelFacts(model, provider, userModel?.contextWindowTokens);
};
