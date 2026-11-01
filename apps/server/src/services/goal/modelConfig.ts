import type { GoalConfig, ProviderConfig, UserSystemAgentConfig } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { UserModel } from '@/database/models/user';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import type { LobeChatDatabase } from '@/database/type';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { resolveProviderRelay } from '@/server/modules/AgentRuntime/llmRelay/resolveLlmExecutionSite';
import { getUserScopedAiProviderRuntimeState } from '@/server/services/aiProviderAccess';
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

/**
 * Refuse a model the goal could not run on. Its planning and Tasks run as the
 * goal's owner, so the pick must be among the models the owner's picker would
 * offer — not merely the caller's, such as a Workspace admin editing a
 * member's goal. Planning also advances in the background with no device
 * attached, so it cannot use a provider only the owner's device reaches.
 */
export const assertGoalModelRunnable = async (
  db: LobeChatDatabase,
  owner: { userId: string; workspaceId?: string | null },
  slot: 'planning' | 'task',
  { model, provider }: { model: string; provider: string },
) => {
  const workspaceId = owner.workspaceId ?? undefined;
  const { aiProvider } = await getServerGlobalConfig();
  const repos = new AiInfraRepos(
    db,
    owner.userId,
    aiProvider as Record<string, ProviderConfig>,
    workspaceId,
  );
  const { enabledAiModels } = await getUserScopedAiProviderRuntimeState(owner.userId, () =>
    repos.getAiProviderRuntimeState(),
  );
  if (!enabledAiModels.some((item) => item.id === model && item.providerId === provider))
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: "This model is not available to the goal's owner",
    });

  if (
    slot === 'planning' &&
    (await resolveProviderRelay({ db, provider, userId: owner.userId, workspaceId }))
  )
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This provider runs only on a device, which background goal planning cannot reach',
    });
};
