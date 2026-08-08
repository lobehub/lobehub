import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import type { LobeAgentAgencyConfig, LobeAgentChatConfig } from '@lobechat/types';

export { DEFAULT_MINI_MODEL, DEFAULT_MODEL } from '@lobechat/business-const';

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * Last-resort model for sub-agents spawned via `lobe-agent.callSubAgent`, used
 * only when neither an explicit `agencyConfig.subagent` override nor the
 * parent's effective model is available at the spawn site.
 *
 * Paired with `DEFAULT_PROVIDER` rather than a dedicated sub-agent provider, so
 * a build that swaps `@lobechat/business-const` (the cloud one routes through
 * its own official provider) moves the sub-agent along with the main model
 * instead of leaving it pointed at a provider that build doesn't serve.
 */
export const DEFAULT_SUB_AGENT_MODEL = 'deepseek-v4-flash';

/**
 * Resolve the model a sub-agent runs on, in precedence order:
 *
 * 1. Explicit `agencyConfig.subagent` override configured on the spawning agent.
 * 2. The parent run's effective model — same provider, same model. Multi-provider
 *    setups otherwise strand sub-agents on a provider the user has moved away
 *    from (Claude Code / Codex sub-agents inherit the parent model the same way).
 * 3. The global default, when the spawn site has no parent model at hand.
 *
 * Model and provider resolve as a pair: mixing one source's model id with
 * another source's provider would produce a `provider/model` combination the
 * user never configured.
 */
export const resolveSubAgentModel = (
  subagent: LobeAgentAgencyConfig['subagent'],
  parentModel?: { model?: string | null; provider?: string | null },
): { model: string; provider: string } => {
  if (subagent?.model)
    return { model: subagent.model, provider: subagent.provider || DEFAULT_PROVIDER };

  if (parentModel?.model)
    return { model: parentModel.model, provider: parentModel.provider || DEFAULT_PROVIDER };

  return { model: DEFAULT_SUB_AGENT_MODEL, provider: DEFAULT_PROVIDER };
};

/**
 * Resolve the effective chatConfig for a `callSubAgent` run: the parent's
 * chatConfig with the agent's `agencyConfig.subagent.chatConfig` overrides
 * (thinking / reasoning-effort extend params) merged on top.
 *
 * `null` / `undefined` override values are skipped rather than copied — a
 * cleared override falls back to the parent value, mirroring how a nulled
 * `subagent.model` falls back to following the parent model.
 */
/**
 * The chatConfig override to apply to a spawned sub-agent, gated on an explicit
 * `subagent.model`: the thinking / reasoning-effort overrides are configured in
 * the UI under the chosen override model, so once the model is cleared (back to
 * follow-parent) a stale `chatConfig` left behind by older writers must not
 * silently keep changing the sub-agent's behavior or cost.
 */
export const getSubAgentChatConfigOverride = (
  subagent: LobeAgentAgencyConfig['subagent'],
): Partial<LobeAgentChatConfig> | undefined =>
  subagent?.model ? (subagent.chatConfig ?? undefined) : undefined;

export const resolveSubAgentChatConfig = <T extends object>(
  parentChatConfig: T | null | undefined,
  override: Partial<T> | null | undefined,
): T | undefined => {
  if (!override) return parentChatConfig ?? undefined;

  const patch = Object.fromEntries(
    Object.entries(override).filter(([, value]) => value !== null && value !== undefined),
  );

  return { ...parentChatConfig, ...patch } as T;
};

export const DEFAULT_RERANK_MODEL = 'rerank-english-v3.0';
export const DEFAULT_RERANK_PROVIDER = 'cohere';
export const DEFAULT_RERANK_QUERY_MODE = 'full_text';
