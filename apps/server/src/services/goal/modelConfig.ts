import type { GoalConfig, UserSystemAgentConfig } from '@lobechat/types';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { resolveSystemAgentModelConfig } from '@/server/services/systemAgent/modelConfig';

/**
 * The model the goal's own planning runs on: the goal's planning-model pick
 * when it has one, otherwise the user's system goal model. Callers that plan
 * for no particular goal (or diagnose rather than plan) omit `goalConfig`.
 */
export const resolveGoalModelConfig = async (
  db: LobeChatDatabase,
  userId: string,
  goalConfig?: GoalConfig | null,
) => {
  if (goalConfig?.model && goalConfig.provider)
    return { model: goalConfig.model, provider: goalConfig.provider };
  const settings = await new UserModel(db, userId).getUserSettings();
  const systemAgent = settings?.systemAgent as Partial<UserSystemAgentConfig> | undefined;

  return resolveSystemAgentModelConfig({
    taskConfig: systemAgent?.goal,
    taskKey: 'goal',
  });
};

/**
 * The goal's own pick for its planning turns, as `execAgent` params. Empty when
 * the goal has none, so the run keeps the goal agent's model.
 */
export const goalModelOverride = (config?: GoalConfig | null) => ({
  ...(config?.model && { model: config.model }),
  ...(config?.provider && { provider: config.provider }),
});

/**
 * The goal's own pick for its Tasks, as Task config. Empty when the goal has
 * none, so a new Task takes its executor's model as usual.
 */
export const goalTaskModelOverride = (config?: GoalConfig | null) => ({
  ...(config?.taskModel && { model: config.taskModel }),
  ...(config?.taskProvider && { provider: config.taskProvider }),
});
