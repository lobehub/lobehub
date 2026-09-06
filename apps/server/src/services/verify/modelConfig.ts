import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import {
  DEFAULT_REVIEW_PREDICT_MODEL,
  DEFAULT_REVIEW_PREDICT_PROVIDER,
  DEFAULT_VERIFY_MODEL,
  DEFAULT_VERIFY_PROVIDER,
} from '@lobechat/business-const';

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
 * The fallback model used by Verify's LobeHub LLM calls when neither a pinned
 * verifier agent nor the builtin verify agent provides a runnable config —
 * and the floor under the whole resolution chain.
 *
 * MUST be vision-capable in model-bank: agent-type checks attach screenshot
 * evidence, and a text-only verifier cannot read the frames it is judging (it
 * has to detour through a vision sub-agent, and the long tail is exactly
 * where verdict submission breaks down — deepseek-v4-pro errored every r6
 * check in production this way). Pinned here so every build judges on the
 * same model regardless of which parent happened to spawn the run; the value
 * lives in `@lobechat/business-const` so the cloud build can override it
 * without touching this service. A model-bank test guards the vision ability.
 */
export const VERIFY_FALLBACK_MODEL_CONFIG: VerifyModelConfig = {
  model: DEFAULT_VERIFY_MODEL,
  provider: DEFAULT_VERIFY_PROVIDER,
};

/**
 * Pick the model used by Verify's LobeHub LLM calls. Heterogeneous parent runs
 * expose CLI/runtime identifiers (e.g. `claude-code`) that are not valid model
 * runtime providers, so Verify must resolve its own runnable provider/model.
 *
 * Resolution order: pinned verifier agent → builtin verify agent →
 * VERIFY_FALLBACK_MODEL_CONFIG. The parent run model is deliberately NOT a
 * source: verification is the quality gate, so it judges on one consistent
 * model instead of inheriting whichever chat model the task happened to run
 * on (drifts the bar between runs, and heterogeneous parents can't be
 * inherited at all).
 */
export const resolveVerifyModelConfig = async (
  db: LobeChatDatabase,
  userId: string,
  params: ResolveVerifyModelConfigParams,
  workspaceId?: string,
): Promise<VerifyModelConfig> => {
  const agentModel = new AgentModel(db, userId, workspaceId);

  if (params.verifierAgentId) {
    const verifierConfig = await agentModel.getAgentModelConfig(params.verifierAgentId);
    if (isUsableVerifyModelConfig(verifierConfig)) return verifierConfig;
  }

  await agentModel.getBuiltinAgent(BUILTIN_AGENT_SLUGS.verifyAgent);
  const builtinConfig = await agentModel.getAgentModelConfig(BUILTIN_AGENT_SLUGS.verifyAgent);
  if (isUsableVerifyModelConfig(builtinConfig)) return builtinConfig;

  return VERIFY_FALLBACK_MODEL_CONFIG;
};
