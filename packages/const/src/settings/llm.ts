import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import type { LobeAgentAgencyConfig } from '@lobechat/types';

export { DEFAULT_MINI_MODEL, DEFAULT_MODEL } from '@lobechat/business-const';

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * Default model for sub-agents spawned via `lobe-agent.callSubAgent`.
 * Sub-agents run on a lightweight model by default instead of inheriting the
 * parent agent's main model. Overridable per agent via `agencyConfig.subagent`.
 *
 * Paired with `DEFAULT_PROVIDER` rather than a dedicated sub-agent provider, so
 * a build that swaps `@lobechat/business-const` (the cloud one routes through
 * its own official provider) moves the sub-agent along with the main model
 * instead of leaving it pointed at a provider that build doesn't serve.
 */
export const DEFAULT_SUB_AGENT_MODEL = 'deepseek-v4-flash';

/**
 * Resolve the model a sub-agent runs on from the spawning agent's
 * `agencyConfig.subagent`, falling back to the global default.
 *
 * Model and provider resolve as a pair: a config carrying a model but no
 * provider would otherwise mix a custom model id with the default provider.
 */
export const resolveSubAgentModel = (
  subagent: LobeAgentAgencyConfig['subagent'],
): { model: string; provider: string } =>
  subagent?.model
    ? { model: subagent.model, provider: subagent.provider || DEFAULT_PROVIDER }
    : { model: DEFAULT_SUB_AGENT_MODEL, provider: DEFAULT_PROVIDER };

export const DEFAULT_RERANK_MODEL = 'rerank-english-v3.0';
export const DEFAULT_RERANK_PROVIDER = 'cohere';
export const DEFAULT_RERANK_QUERY_MODE = 'full_text';
