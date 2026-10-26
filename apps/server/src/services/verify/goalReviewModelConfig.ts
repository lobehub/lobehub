import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { DEFAULT_ACCEPTANCE_DISPUTE_PANEL } from '@lobechat/business-const';
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

type ModelCandidate = { model?: string | null; provider?: string | null } | null | undefined;

/**
 * Probe a candidate review model within the task owner's scope: skip CLI agents,
 * a model already tried, a text-only model when frames must be read, and a
 * provider whose credentials cannot initialize.
 */
const createReviewModelProbe = async (
  db: LobeChatDatabase,
  userId: string,
  requiresVision: boolean,
  workspaceId?: string,
) => {
  const { aiProvider } = await getServerGlobalConfig();
  const providerConfigs: Record<string, ProviderConfig> = Object.fromEntries(
    Object.entries(aiProvider).map<[string, ProviderConfig]>(([id, config]) => [
      id,
      { ...config, enabled: config?.enabled ?? false },
    ]),
  );
  const infra = new AiInfraRepos(db, userId, providerConfigs, workspaceId);
  const tried = new Set<string>();
  return async (candidate: ModelCandidate): Promise<VerifyModelConfig | undefined> => {
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
    if (requiresVision) {
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
};

/**
 * The review model chain in preference order, read lazily so a caller that
 * stops at the first usable model never pays for the later lookups.
 */
async function* reviewModelCandidates(
  db: LobeChatDatabase,
  userId: string,
  params: { taskId?: string; verifierAgentId?: string | null },
  workspaceId?: string,
): AsyncGenerator<ModelCandidate> {
  const agents = new AgentModel(db, userId, workspaceId);
  if (params.verifierAgentId) yield agents.getAgentModelConfig(params.verifierAgentId);
  yield REVIEW_PREDICT_MODEL_CONFIG;
  yield agents.getAgentModelConfig(BUILTIN_AGENT_SLUGS.verifyAgent);

  // Program checks may never have needed a verifier model. Fall back to the
  // task's configured model, then the user's Goal system-agent configuration.
  if (params.taskId) {
    const task = await new TaskModel(db, userId, workspaceId).findById(params.taskId);
    const taskConfig = toRecord(task?.config);
    yield {
      model: pickTrimmedString(taskConfig?.model),
      provider: pickTrimmedString(taskConfig?.provider),
    };
    if (task?.assigneeAgentId) yield agents.getAgentModelConfig(task.assigneeAgentId);
  }
  yield resolveGoalModelConfig(db, userId);
}

/** Resolve within the task owner's scope; never select an arbitrary enabled model. */
export const resolveGoalReviewModelConfig = async (
  db: LobeChatDatabase,
  userId: string,
  params: { requiresVision: boolean; taskId: string; verifierAgentId?: string | null },
  workspaceId?: string,
): Promise<VerifyModelConfig | undefined> => {
  const usable = await createReviewModelProbe(db, userId, params.requiresVision, workspaceId);
  for await (const candidate of reviewModelCandidates(db, userId, params, workspaceId)) {
    const config = await usable(candidate);
    if (config) return config;
  }
};

export const DISPUTE_PANEL_SIZE = 3;

/**
 * The models that arbitrate a disputed check: the pinned cross-vendor panel
 * first, topped up from the review model chain when a pinned provider is not
 * configured. Every seat is a different provider — three models from one
 * vendor share its blind spots, so a same-vendor majority is not the
 * independent second opinion the panel exists to give. Returns fewer than
 * {@link DISPUTE_PANEL_SIZE} when the scope has no more usable providers; the
 * caller must not rule on that.
 */
export const resolveDisputePanelModelConfigs = async (
  db: LobeChatDatabase,
  userId: string,
  params: { taskId?: string; verifierAgentId?: string | null },
  workspaceId?: string,
): Promise<VerifyModelConfig[]> => {
  // The panel rules on the check's wording against the requirement; it reads no frames.
  const usable = await createReviewModelProbe(db, userId, false, workspaceId);
  const panel: VerifyModelConfig[] = [];
  const seat = async (candidate: ModelCandidate) => {
    // A provider already seated is skipped before probing, which also spares the probe.
    if (!candidate?.provider || panel.some((member) => member.provider === candidate.provider))
      return;
    const config = await usable(candidate);
    if (config) panel.push(config);
  };
  for (const member of DEFAULT_ACCEPTANCE_DISPUTE_PANEL) {
    await seat(member);
    if (panel.length === DISPUTE_PANEL_SIZE) return panel;
  }
  for await (const candidate of reviewModelCandidates(db, userId, params, workspaceId)) {
    await seat(candidate);
    if (panel.length === DISPUTE_PANEL_SIZE) return panel;
  }
  return panel;
};
