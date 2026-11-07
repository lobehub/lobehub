import debug from 'debug';

import { isResponsesAPIModel } from '../../providers/openai/modelId';

export interface ShouldUseResponsesAPIParams {
  /** Context for logging (e.g., 'chat', 'generateObject', 'tool calling') */
  context?: string;
  /** Factory/instance level useResponse flag */
  flagUseResponse?: boolean;
  /** Factory/instance level model patterns for Responses API */
  flagUseResponseModels?: Array<string | RegExp>;
  /** Provider-level hard opt-out from the Responses API */
  forceChatCompletions?: boolean;
  /** The model ID to check */
  model?: string;
  /** Explicit responseApi flag */
  responseApi?: boolean;
  /** User-specified API mode (highest priority) */
  userApiMode?: string;
}

/**
 * Determine whether an OpenAI-compatible operation should use the Responses API.
 *
 * `forceChatCompletions` is a provider-level capability declaration, so it must
 * run before built-in model-name heuristics and user-level switches.
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
    forceChatCompletions,
    context = 'operation',
  } = params;

  const log = debug(`${logPrefix}:shouldUseResponsesAPI`);

  if (forceChatCompletions) {
    log('using Chat Completions API: provider forceChatCompletions=true');
    return false;
  }

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
