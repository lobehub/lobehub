export const DEFAULT_EMBEDDING_PROVIDER = 'openai';

export const DEFAULT_MODEL = 'deepseek-v4-pro';
export const DEFAULT_PROVIDER = 'deepseek';
export const DEFAULT_MINI_MODEL = 'gpt-5.4-mini';
export const DEFAULT_MINI_PROVIDER = 'openai';

export const DEFAULT_ONBOARDING_MODEL = 'gemini-3-flash-preview';
export const DEFAULT_ONBOARDING_PROVIDER = 'google';

/**
 * Default model for sub-agents spawned via `lobe-agent.callSubAgent`.
 * Sub-agents run on a lightweight model by default instead of inheriting the
 * parent agent's main model. Overridable per agent via `agencyConfig.subagent`.
 */
export const DEFAULT_SUB_AGENT_MODEL = 'deepseek-v4-flash';
export const DEFAULT_SUB_AGENT_PROVIDER = 'deepseek';
