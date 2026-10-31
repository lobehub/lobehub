import { BRANDING_PROVIDER, ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM } from '@lobechat/const';
import { type LobeChatDatabase } from '@lobechat/database';

import { FtsSearchCandidateError } from '@/database/repositories/ftsSearch';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

export const getEmbeddingRuntime = async (serverDB: LobeChatDatabase, userId: string) => {
  const { provider, model: embeddingModel } =
    getServerDefaultFilesConfig().embeddingModel || DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM;
  // Read user's provider config from database
  const agentRuntime = await initModelRuntimeFromDB(
    serverDB,
    userId,
    ENABLE_BUSINESS_FEATURES ? BRANDING_PROVIDER : provider,
  );

  return { agentRuntime, embeddingModel };
};

/** Candidate-provider outages must not be converted into successful empty memory responses. */
export const rethrowCandidateSearchError = (error: unknown) => {
  if (error instanceof FtsSearchCandidateError) throw error;
};
