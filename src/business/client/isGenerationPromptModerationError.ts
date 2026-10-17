/**
 * Whether a generation submit failed because the prompt itself was rejected by
 * content moderation. Callers show this next to the prompt input instead of as a
 * generic request error.
 */
export const isGenerationPromptModerationError = (_error: unknown): boolean => false;
