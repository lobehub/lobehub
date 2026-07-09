export const DEFAULT_EMBEDDING_PROVIDER = 'openai';

export const DEFAULT_MODEL = 'deepseek-v4-pro';
export const DEFAULT_PROVIDER = 'deepseek';
export const DEFAULT_MINI_MODEL = 'gpt-5.4-mini';
export const DEFAULT_MINI_PROVIDER = 'openai';

export const DEFAULT_ONBOARDING_MODEL = 'gemini-3-flash-preview';
export const DEFAULT_ONBOARDING_PROVIDER = 'google';

/**
 * Default provider for sub-agents spawned via `lobe-agent.callSubAgent`.
 * Kept here (not in the neutral `@lobechat/const`) because the cloud build
 * rewrites this package to `@cloud/business-const` and routes the sub-agent
 * through its own official provider. The paired model id lives in
 * `@lobechat/const` (`DEFAULT_SUB_AGENT_MODEL`) since it is stable across builds.
 */
export const DEFAULT_SUB_AGENT_PROVIDER = 'deepseek';
