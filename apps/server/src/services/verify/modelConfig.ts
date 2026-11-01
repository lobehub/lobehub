import {
  DEFAULT_REVIEW_PREDICT_MODEL,
  DEFAULT_REVIEW_PREDICT_PROVIDER,
  DEFAULT_VERIFY_MODEL,
  DEFAULT_VERIFY_PLAN_MODEL,
  DEFAULT_VERIFY_PLAN_PROVIDER,
  DEFAULT_VERIFY_PROVIDER,
} from '@lobechat/business-const';
import type { SystemAgentItem, UserSystemAgentConfig } from '@lobechat/types';
import {
  LOCAL_HETEROGENEOUS_AGENT_TYPES,
  REMOTE_HETEROGENEOUS_AGENT_CONFIGS,
} from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { parseSystemAgent } from '@/server/globalConfig/parseSystemAgent';

export interface VerifyModelConfig {
  model: string;
  provider: string;
}

interface ResolveVerifyModelConfigParams {
  parentModel?: string | null;
  parentProvider?: string | null;
  verifierAgentId?: string | null;
}

const HETEROGENEOUS_PROVIDER_IDS = new Set<string>([
  ...LOCAL_HETEROGENEOUS_AGENT_TYPES,
  ...REMOTE_HETEROGENEOUS_AGENT_CONFIGS.map(({ type }) => type),
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

/**
 * The model every verify plan generation (requirement → named criteria) runs on.
 *
 * Deliberately NOT `resolveVerifyModelConfig`: that chain follows the verifier
 * agent's chat model, which may be a slow reasoning model that returns no
 * parsable structured output. A failed split is silent — the plan falls back
 * to one holistic "Task delivery acceptance" row — so the split runs on one
 * pinned model instead of whatever the user's verifier happens to use. The
 * values live in `@lobechat/business-const` so the cloud build can override them.
 */
export const VERIFY_PLAN_MODEL_CONFIG: VerifyModelConfig = {
  model: DEFAULT_VERIFY_PLAN_MODEL,
  provider: DEFAULT_VERIFY_PLAN_PROVIDER,
};

const isUsableVerifyModelConfig = (
  config?: { model?: string | null; provider?: string | null } | null,
): config is VerifyModelConfig =>
  Boolean(config?.model && config?.provider && !isHeterogeneousVerifyProvider(config.provider));

/**
 * The fallback model used by Verify's LobeHub LLM calls when neither a pinned
 * verifier agent nor the user's or deployment's `verify` service model
 * provides a runnable config — the floor under the whole resolution chain.
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
 * The `verify` service model: the user's pick in Settings → Service Model,
 * then the deployment's `SYSTEM_AGENT` (`verify=` or `default=`). Undefined
 * when neither set one, so callers fall through to their own floor.
 */
export const resolveVerifyServiceModel = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<VerifyModelConfig | undefined> => {
  const settings = await new UserModel(db, userId).getUserSettings();
  const systemAgent = settings?.systemAgent as Partial<UserSystemAgentConfig> | undefined;
  const candidates: (Partial<SystemAgentItem> | undefined)[] = [
    systemAgent?.verify,
    parseSystemAgent(appEnv.SYSTEM_AGENT).verify,
  ];
  for (const candidate of candidates) {
    if (isUsableVerifyModelConfig(candidate))
      return { model: candidate.model, provider: candidate.provider };
  }
};

/**
 * Pick the model used by Verify's LobeHub LLM calls. Heterogeneous parent runs
 * expose CLI/runtime identifiers (e.g. `claude-code`) that are not valid model
 * runtime providers, so Verify must resolve its own runnable provider/model.
 *
 * Resolution order: pinned verifier agent → `verify` service model (user, then
 * deployment) → VERIFY_FALLBACK_MODEL_CONFIG. The parent run model is
 * deliberately NOT a source: verification is the quality gate, so it judges on
 * one consistent model instead of inheriting whichever chat model the task
 * happened to run on (drifts the bar between runs, and heterogeneous parents
 * can't be inherited at all).
 *
 * The builtin verify agent's own row is NOT a source either: it is persisted
 * with the generic chat default, which may be text-only, and no UI edits it —
 * reading it first meant the vision-capable floor was never reached.
 */
export const resolveVerifyModelConfig = async (
  db: LobeChatDatabase,
  userId: string,
  params: ResolveVerifyModelConfigParams,
  workspaceId?: string,
): Promise<VerifyModelConfig> => {
  if (params.verifierAgentId) {
    const agentModel = new AgentModel(db, userId, workspaceId);
    const verifierConfig = await agentModel.getAgentModelConfig(params.verifierAgentId);
    if (isUsableVerifyModelConfig(verifierConfig)) return verifierConfig;
  }

  return (await resolveVerifyServiceModel(db, userId)) ?? VERIFY_FALLBACK_MODEL_CONFIG;
};
