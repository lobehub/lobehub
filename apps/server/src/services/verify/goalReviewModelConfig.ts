import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { ProviderConfig } from '@lobechat/types';
import { pickTrimmedString, toRecord } from '@lobechat/utils/object';

import { AgentModel } from '@/database/models/agent';
import { TaskModel } from '@/database/models/task';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import type { LobeChatDatabase } from '@/database/type';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { resolveGoalModelConfig } from '@/server/services/goal/modelConfig';

import type { VerifyModelConfig } from './modelConfig';
import { isHeterogeneousVerifyProvider, REVIEW_PREDICT_MODEL_CONFIG } from './modelConfig';

/** Resolve within the task owner's scope; never select an arbitrary enabled model. */
export const resolveGoalReviewModelConfig = async (
  db: LobeChatDatabase,
  userId: string,
  params: { requiresVision: boolean; taskId: string; verifierAgentId?: string | null },
  workspaceId?: string,
): Promise<VerifyModelConfig | undefined> => {
  const agents = new AgentModel(db, userId, workspaceId);
  const { aiProvider } = await getServerGlobalConfig();
  const providerConfigs: Record<string, ProviderConfig> = Object.fromEntries(
    Object.entries(aiProvider).map<[string, ProviderConfig]>(([id, config]) => [
      id,
      { ...config, enabled: config?.enabled ?? false },
    ]),
  );
  const infra = new AiInfraRepos(db, userId, providerConfigs, workspaceId);
  const tried = new Set<string>();
  const usable = async (candidate?: { model?: string | null; provider?: string | null } | null) => {
    if (
      !candidate?.model ||
      !candidate.provider ||
      isHeterogeneousVerifyProvider(candidate.provider)
    )
      return;
    const config = { model: candidate.model, provider: candidate.provider };
    const key = JSON.stringify(config);
    if (tried.has(key)) return;
    tried.add(key);
    if (params.requiresVision) {
      const models = await infra.getAiProviderModelList(config.provider, { type: 'chat' });
      if (!models.some((model) => model.id === config.model && model.abilities?.vision)) return;
    }
    try {
      // Uses the same user/workspace vaults and deployment credentials as generation.
      // No paid probe call: missing credentials fail during runtime construction.
      await initModelRuntimeFromDB(db, userId, config.provider, workspaceId);
      return config;
    } catch (error) {
      console.error('[goal-review] Could not initialize review provider:', config.provider, error);
      return;
    }
  };

  if (params.verifierAgentId) {
    const configured = await usable(await agents.getAgentModelConfig(params.verifierAgentId));
    if (configured) return configured;
  }
  const pinned = await usable(REVIEW_PREDICT_MODEL_CONFIG);
  if (pinned) return pinned;
  const builtin = await usable(await agents.getAgentModelConfig(BUILTIN_AGENT_SLUGS.verifyAgent));
  if (builtin) return builtin;

  // Program checks may never have needed a verifier model. Fall back to the
  // task's configured model, then the user's Goal system-agent configuration.
  const task = await new TaskModel(db, userId, workspaceId).findById(params.taskId);
  const taskConfig = toRecord(task?.config);
  const taskModel = await usable({
    model: pickTrimmedString(taskConfig?.model),
    provider: pickTrimmedString(taskConfig?.provider),
  });
  if (taskModel) return taskModel;
  if (task?.assigneeAgentId) {
    const assigned = await usable(await agents.getAgentModelConfig(task.assigneeAgentId));
    if (assigned) return assigned;
  }
  return usable(await resolveGoalModelConfig(db, userId));
};
