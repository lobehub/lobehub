import type { UserServiceModelConfig } from '@lobechat/types';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { resolveSystemAgentModelConfig } from '@/server/services/systemAgent/modelConfig';

/**
 * The model background self-iteration runs on: the user's Memory Analysis service model,
 * which follows the Flash tier unless the user pins it.
 *
 * Self-iteration (feedback judges, reflection, nightly review, skill management) is the same
 * kind of unattended, user-billed analysis that slot already governs for memory extraction,
 * so it shares the slot instead of hardcoding the deployment's mini default — that default
 * may name a provider the user never enabled, which made every run fail.
 */
export const resolveAgentSignalModelConfig = async (db: LobeChatDatabase, userId: string) => {
  const settings = await new UserModel(db, userId).getUserSettings();
  const systemAgent = settings?.systemAgent as Partial<UserServiceModelConfig> | undefined;

  return resolveSystemAgentModelConfig({
    taskConfig: systemAgent?.memoryAnalysisAgentConfig,
    taskKey: 'memoryAnalysisAgentConfig',
  });
};
