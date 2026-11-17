import { DEFAULT_FILE_EMBEDDING_MODEL_ITEM } from '@lobechat/const';
import { type LobeChatDatabase } from '@lobechat/database';
import type { FilesConfigItem, UserSystemAgentConfig } from '@lobechat/types';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';

const log = debug('lobe-server:file-embedding-model');

/**
 * The model that embeds file chunks and knowledge-base search queries, in this
 * order: the user's Service Model pick, the deployment's `DEFAULT_FILES_CONFIG`
 * `embedding_model`, the code default. With no pick this is exactly what ran
 * before the setting existed. Indexing and search must both come through here,
 * or queries are embedded by a different model than the chunks they search.
 */
export const resolveFileEmbeddingModel = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<FilesConfigItem> => {
  const settings = await new UserModel(db, userId).getUserSettings();
  const picked = (settings?.systemAgent as Partial<UserSystemAgentConfig> | undefined)
    ?.fileEmbedding;

  if (picked?.model && picked.provider) {
    log('user setting: %s/%s', picked.provider, picked.model);
    return { model: picked.model, provider: picked.provider };
  }

  // Parsed only without a pick, so a broken `DEFAULT_FILES_CONFIG` keeps failing
  // as before without blocking a user who chose a model.
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
