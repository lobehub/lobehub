export const DEFAULT_EMBEDDING_PROVIDER = 'openai';

/**
 * Default chat model — product Auto router (`openrouter/auto` storage id).
 * UI brands it as `{BRANDING_NAME}/auto` (e.g. panachat/auto). Never use a
 * direct openai/* SKU as the product default.
 */
export const DEFAULT_MODEL = 'openrouter/auto';
/** Managed provider surface (UI shows BRANDING_NAME, not OpenRouter). */
export const DEFAULT_PROVIDER = 'openrouter';
export const DEFAULT_MINI_MODEL = 'gpt-5.4-mini';
export const DEFAULT_MINI_PROVIDER = 'openai';

export const DEFAULT_ONBOARDING_MODEL = 'gemini-3-flash-preview';
export const DEFAULT_ONBOARDING_PROVIDER = 'google';
