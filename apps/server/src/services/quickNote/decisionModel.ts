import type { UserSystemAgentConfig } from '@lobechat/types';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { parseSystemAgent } from '@/server/globalConfig/parseSystemAgent';
import { resolveSystemAgentModelConfig } from '@/server/services/systemAgent/modelConfig';

/**
 * Resolves the `quickNoteDecision` system agent slot like other server-side system agents: user
 * setting, then the `SYSTEM_AGENT` env, then the built-in default.
 *
 * The slot accepts chat and decision models; `ModelRuntime.decide` answers natively for a
 * decision model and emulates the decision on a chat model.
 */
export const resolveQuickNoteDecisionModel = async (db: LobeChatDatabase, userId: string) => {
  const settings = await new UserModel(db, userId).getUserSettings();
  const userSystemAgent = settings?.systemAgent as Partial<UserSystemAgentConfig> | undefined;
  return resolveSystemAgentModelConfig({
    override: userSystemAgent?.quickNoteDecision,
    taskConfig: parseSystemAgent(appEnv.SYSTEM_AGENT).quickNoteDecision,
    taskKey: 'quickNoteDecision',
  });
};
