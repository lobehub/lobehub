/** Default embedding via managed OpenRouter (OpenAI-compatible id). */
export const DEFAULT_EMBEDDING_PROVIDER = 'openrouter';

/**
 * Default chat model — product Auto router (`openrouter/auto` storage id).
 * UI brands it as `{BRANDING_NAME}/auto` (e.g. panachat/auto). Never use a
 * direct openai/* SKU as the product default.
 */
export const DEFAULT_MODEL = 'openrouter/auto';
/** Managed provider surface (UI shows BRANDING_NAME, not OpenRouter). */
export const DEFAULT_PROVIDER = 'openrouter';
/** Lightweight helpers / system agents — OpenRouter SKU, never direct openai. */
export const DEFAULT_MINI_MODEL = 'openai/gpt-4o-mini';
export const DEFAULT_MINI_PROVIDER = 'openrouter';

/** Onboarding / first-agent defaults must stay on the managed OpenRouter surface. */
export const DEFAULT_ONBOARDING_MODEL = 'openrouter/auto';
export const DEFAULT_ONBOARDING_PROVIDER = 'openrouter';
