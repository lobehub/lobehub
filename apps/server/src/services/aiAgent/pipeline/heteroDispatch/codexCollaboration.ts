import type { ChatTopicMetadata, CodexCollaborationMode } from '@lobechat/types';
import { codexCollaborationModeOf } from '@lobechat/types';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-server:hetero-dispatch:codex-collaboration');

/**
 * The collaboration mode a dispatched Codex run sends (Better Coding Experience
 * Plan switch), before the device's runtime is known: only with both labs on
 * (Better Coding Experience and the Codex app-server) and a topic that turned
 * Plan on at least once; otherwise none, exactly as before the lab. Codex keeps
 * the mode on the thread, so once used it is sent on every turn.
 *
 * A failed preference read sends no mode rather than guessing.
 */
export const resolveDispatchCollaborationMode = async (
  db: LobeChatDatabase,
  userId: string,
  params: { heteroType: string; topicMetadata: ChatTopicMetadata | null | undefined },
): Promise<CodexCollaborationMode | undefined> => {
  if (params.heteroType !== 'codex') return;
  const mode = codexCollaborationModeOf(params.topicMetadata?.heteroPlanMode);
  if (!mode) return;
  try {
    const lab = (await new UserModel(db, userId).getUserPreference())?.lab;
    return lab?.enableBetterCodingExperience && lab?.enableCodexAppServer ? mode : undefined;
  } catch (error) {
    log('Reading the lab preference of %s failed: %O', userId, error);
  }
};

/**
 * The mode a device run actually carries: only a native app-server run on an
 * `lh` that takes it (`codex-collaboration-mode-v1`); `codex exec` has none.
 */
export const forDeviceRuntime = (
  mode: CodexCollaborationMode | undefined,
  runtime: { native: boolean; supportsCollaborationMode: boolean },
): CodexCollaborationMode | undefined =>
  runtime.native && runtime.supportsCollaborationMode ? mode : undefined;
