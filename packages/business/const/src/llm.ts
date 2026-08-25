export const DEFAULT_EMBEDDING_PROVIDER = 'openai';

export const DEFAULT_MODEL = 'deepseek-v4-flash';
export const DEFAULT_PROVIDER = 'deepseek';
export const DEFAULT_MINI_MODEL = 'gpt-5.6-luna';
export const DEFAULT_MINI_PROVIDER = 'openai';

export const DEFAULT_ONBOARDING_MODEL = 'gemini-3-flash-preview';
export const DEFAULT_ONBOARDING_PROVIDER = 'google';

/**
 * The model Acceptance review predictions judge evidence screenshots with.
 * MUST be vision-capable — a text-only model silently "accepts on missing
 * evidence" for every check and no proposal ever surfaces (a model-bank
 * test in apps/server guards this).
 */
export const DEFAULT_REVIEW_PREDICT_MODEL = 'gemini-3.6-flash';
export const DEFAULT_REVIEW_PREDICT_PROVIDER = 'google';
