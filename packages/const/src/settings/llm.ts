// `DEFAULT_SUB_AGENT_PROVIDER` stays in `@lobechat/business-const` so the cloud
// build can override it (routes through its own official provider); the paired
// model id is a generic default defined below. Re-exported here so callers pull
// both from `@lobechat/const` and never import the swapped package directly.
export {
  DEFAULT_MINI_MODEL,
  DEFAULT_MODEL,
  DEFAULT_SUB_AGENT_PROVIDER,
} from '@lobechat/business-const';

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * Default model for sub-agents spawned via `lobe-agent.callSubAgent`.
 * Sub-agents run on a lightweight model by default instead of inheriting the
 * parent agent's main model. Overridable per agent via `agencyConfig.subagent`.
 */
export const DEFAULT_SUB_AGENT_MODEL = 'deepseek-v4-flash';

export const DEFAULT_RERANK_MODEL = 'rerank-english-v3.0';
export const DEFAULT_RERANK_PROVIDER = 'cohere';
export const DEFAULT_RERANK_QUERY_MODE = 'full_text';
