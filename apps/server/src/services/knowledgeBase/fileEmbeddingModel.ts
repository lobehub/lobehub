import { DEFAULT_FILE_EMBEDDING_MODEL_ITEM } from '@lobechat/const';
import { type LobeChatDatabase } from '@lobechat/database';
import type { FilesConfigItem, UserSystemAgentConfig } from '@lobechat/types';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import { normalizeWorkspaceId } from '@/database/utils/workspace';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';

const log = debug('lobe-server:file-embedding-model');

/** Team members share a vector index, so use the deployment default for its reads and writes. */
export const resolveFileEmbeddingModel = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): Promise<FilesConfigItem> => {
  if (!normalizeWorkspaceId(workspaceId)) {
    const settings = await new UserModel(db, userId).getUserSettings();
    const picked = (settings?.systemAgent as Partial<UserSystemAgentConfig> | undefined)
      ?.fileEmbedding;

    if (picked?.model && picked.provider) {
      log('user setting: %s/%s', picked.provider, picked.model);
      return { model: picked.model, provider: picked.provider };
    }
  }

  const deployment = getServerDefaultFilesConfig().embeddingModel;
  const resolved = deployment || DEFAULT_FILE_EMBEDDING_MODEL_ITEM;
  log(
    '%s: %s/%s',
    deployment ? 'DEFAULT_FILES_CONFIG' : 'code default',
    resolved.provider,
    resolved.model,
  );
  return resolved;
};
