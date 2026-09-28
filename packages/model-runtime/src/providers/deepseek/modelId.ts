/**
 * DeepSeek model-id predicates. Kept dependency-free so callers outside the
 * runtime (the shared `@lobechat/mecha` rules) can import them without
 * pulling the model bank in.
 */
export const isDeepSeekV4FamilyModel = (model: string | undefined): boolean =>
  typeof model === 'string' &&
  (model.toLowerCase().includes('deepseek-v4') ||
    model.toLowerCase().split('/').at(-1) === 'deepseek-flash');

export const isDeepSeekThinkingEligibleModel = (model: string | undefined): boolean =>
  typeof model === 'string' &&
  (model.toLowerCase().includes('deepseek-reasoner') || isDeepSeekV4FamilyModel(model));
