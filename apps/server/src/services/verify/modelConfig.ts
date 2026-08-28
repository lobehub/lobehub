import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import {
  DEFAULT_PROVIDER,
  DEFAULT_REVIEW_PREDICT_MODEL,
  DEFAULT_REVIEW_PREDICT_PROVIDER,
} from '@lobechat/business-const';
import { DEFAULT_MODEL } from '@lobechat/const';

import { AgentModel } from '@/database/models/agent';
import type { LobeChatDatabase } from '@/database/type';

export interface VerifyModelConfig {
  model: string;
  provider: string;
}

interface ResolveVerifyModelConfigParams {
  parentModel?: string | null;
  parentProvider?: string | null;
  verifierAgentId?: string | null;
}

const HETEROGENEOUS_PROVIDER_IDS = new Set([
  'amp',
  'claude-code',
  'codex',
  'cursor',
  'droid',
  'hermes',
  'opencode',
  'openclaw',
]);

export const isHeterogeneousVerifyProvider = (provider?: string | null): boolean =>
  Boolean(provider && HETEROGENEOUS_PROVIDER_IDS.has(provider));

/**
 * The model the review predictor judges evidence screenshots with.
 *
 * Deliberately NOT `resolveVerifyModelConfig`: that chain follows the verifier
 * agent's chat model, which is chosen for text and may not read images at all.
 * A text-only model never errors here — the channel strips the image parts, the
 * model "accepts on missing evidence" at floor confidence, and no proposal ever
 * surfaces. Predictions are also compared across acceptances, so one pinned
 * vision model keeps the agreement stats about the model, not about whichever
 * verifier each run happened to use.
 *
 * The pinned model MUST have `vision: true` in model-bank; a test guards this.
 * The values live in `@lobechat/business-const` so the cloud build can override
 * them without touching this service.
 */
export const REVIEW_PREDICT_MODEL_CONFIG: VerifyModelConfig = {
  model: DEFAULT_REVIEW_PREDICT_MODEL,
  provider: DEFAULT_REVIEW_PREDICT_PROVIDER,
};

const isUsableVerifyModelConfig = (
  config?: { model?: string | null; provider?: string | null } | null,
): config is VerifyModelConfig =>
  Boolean(config?.model && config?.provider && !isHeterogeneousVerifyProvider(config.provider));

/**
 * Pick the model used by Verify's LobeHub LLM calls. Heterogeneous parent runs
 * expose CLI/runtime identifiers (e.g. `claude-code`) that are not valid model
 * runtime providers, so Verify must resolve its own runnable provider/model.
 */
export const resolveVerifyModelConfig = async (
  db: LobeChatDatabase,
  userId: string,
  params: ResolveVerifyModelConfigParams,
  workspaceId?: string,
): Promise<VerifyModelConfig> => {
  const agentModel = new AgentModel(db, userId, workspaceId);

  const hasPinnedVerifier = Boolean(params.verifierAgentId);

  if (params.verifierAgentId) {
    const verifierConfig = await agentModel.getAgentModelConfig(params.verifierAgentId);
    if (isUsableVerifyModelConfig(verifierConfig)) return verifierConfig;
  }

  const parentConfig = {
    model: params.parentModel,
    provider: params.parentProvider,
  };
  if (!hasPinnedVerifier && isUsableVerifyModelConfig(parentConfig)) return parentConfig;

  await agentModel.getBuiltinAgent(BUILTIN_AGENT_SLUGS.verifyAgent);
  const builtinConfig = await agentModel.getAgentModelConfig(BUILTIN_AGENT_SLUGS.verifyAgent);
  if (isUsableVerifyModelConfig(builtinConfig)) return builtinConfig;

  return { model: DEFAULT_MODEL, provider: DEFAULT_PROVIDER };
};
