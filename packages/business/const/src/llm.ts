export const DEFAULT_EMBEDDING_PROVIDER = 'openai';

/**
 * Default chat model — OpenRouter id under the openai/ family.
 * Platform defaults keep the newest 4 chat models per openai/anthropic/google enabled;
 * this fallback must stay in that set when present in the catalog.
 */
export const DEFAULT_MODEL = 'openai/gpt-4o';
/** Managed provider surface (shown as Aico). */
export const DEFAULT_PROVIDER = 'openrouter';
export const DEFAULT_MINI_MODEL = 'gpt-5.4-mini';
export const DEFAULT_MINI_PROVIDER = 'openai';

export const DEFAULT_ONBOARDING_MODEL = 'gemini-3-flash-preview';
export const DEFAULT_ONBOARDING_PROVIDER = 'google';
