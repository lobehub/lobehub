import debug from 'debug';

import { isResponsesAPIModel } from '../../providers/openai/modelId';

export interface ShouldUseResponsesAPIParams {
  /** Context for logging (e.g., 'chat', 'generateObject', 'tool calling') */
  context?: string;
  /** Factory/instance level useResponse flag */
  flagUseResponse?: boolean;
  /** Factory/instance level model patterns for Responses API */
  flagUseResponseModels?: Array<string | RegExp>;
  /** The model ID to check */
  model?: string;
  /** Explicit responseApi flag */
  responseApi?: boolean;
  /** User-specified API mode (highest priority) */
  userApiMode?: string;
}

/**
 * Determine if should use Responses API based on various configuration options
 * @returns true if should use Responses API, false otherwise
 */
export const shouldUseResponsesAPI = (
  params: ShouldUseResponsesAPIParams,
  logPrefix: string,
): boolean => {
  const {
    model,
    userApiMode,
    responseApi,
    flagUseResponse,
    flagUseResponseModels,
    context = 'operation',
  } = params;

  const log = debug(`${logPrefix}:shouldUseResponsesAPI`);

  // Priority 0: Check built-in Responses API model rules FIRST (highest priority)
  // These models MUST use Responses API regardless of user settings.
  if (model && isResponsesAPIModel(model)) {
    log('using Responses API: model %s matches built-in Responses API model rules', model);
    return true;
  }

  // Priority 1: userApiMode is explicitly set to 'chatCompletion' (user disabled the switch)
  if (userApiMode === 'chatCompletion') {
    log('using Chat Completions API: userApiMode=%s', userApiMode);
    return false;
  }

  // Priority 2: When user enables the switch (userApiMode === 'responses')
  // Check if useResponseModels is configured - if so, only matching models use Responses API
  // If useResponseModels is not configured, all models use Responses API
  if (userApiMode === 'responses') {
    if (model && flagUseResponseModels?.length) {
      const matches = flagUseResponseModels.some((m: string | RegExp) =>
        typeof m === 'string' ? model.includes(m) : (m as RegExp).test(model),
      );
      if (matches) {
        log(
          'using Responses API: userApiMode=responses and model %s matches useResponseModels',
          model,
        );
        return true;
      }
      log(
        'using Chat Completions API: userApiMode=responses but model %s does not match useResponseModels',
        model,
      );
      return false;
    }
    // No useResponseModels configured, use Responses API for all models
    log('using Responses API: userApiMode=responses (no useResponseModels filter)');
    return true;
  }

  // Priority 3: Explicit responseApi flag
  if (responseApi) {
    log('using Responses API: explicit responseApi flag for %s', context);
    return true;
  }

  // Priority 4: Factory/instance level useResponse flag
  if (flagUseResponse) {
    log('using Responses API: flagUseResponse=true for %s', context);
    return true;
  }

  // Priority 5: Check if model matches useResponseModels patterns (without user switch)
  if (model && flagUseResponseModels?.length) {
    const matches = flagUseResponseModels.some((m: string | RegExp) =>
      typeof m === 'string' ? model.includes(m) : (m as RegExp).test(model),
    );
    if (matches) {
      log('using Responses API: model %s matches useResponseModels config', model);
      return true;
    }
  }

  log('using Chat Completions API for %s', context);
  return false;
};

export const resolvePromptCacheKey = (
  model: string | undefined,
  user: string | undefined,
  promptCacheKeyModels: Array<string | RegExp> | undefined,
) => {
  if (!user) return;

  // Keep the default key at {userId}:{model}; {agentId/topicId} can be added later if a narrower cache bucket is needed.
  if (model?.startsWith('gpt-') || /^o\d/.test(model || '') || model === 'chat-latest') {
    return `lobe:${user}:${model}`;
  }

  const matchesProviderPromptCacheModel = promptCacheKeyModels?.some((item) => {
    if (!model) return false;
    if (typeof item === 'string') return model.includes(item);

    item.lastIndex = 0;
    return item.test(model);
  });
  if (matchesProviderPromptCacheModel) {
    return `lobe:${user}:${model}`;
  }
};
