import debug from 'debug';

import { ErrorClassifier, refineErrorCode } from '../../errors';
import type { ChatCompletionErrorPayload } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import { desensitizeUrl } from '../../utils/desensitizeUrl';
import { handleOpenAIError } from '../../utils/handleOpenAIError';
import { ContextExceededPreFlightError } from '../../utils/resolveSafeMaxTokens';
import type { OpenAICompatibleRuntimeContext } from './context';
import type { OpenAICompatibleFactoryOptions } from './factoryOptions';

export const resolveErrorTypes = ({ errorType }: OpenAICompatibleFactoryOptions) => ({
  bizError: errorType?.bizError || AgentRuntimeErrorType.ProviderBizError,
  invalidAPIKey: errorType?.invalidAPIKey || AgentRuntimeErrorType.InvalidProviderAPIKey,
});

export const mapOpenAICompatibleError = (
  runtime: OpenAICompatibleRuntimeContext,
  factory: OpenAICompatibleFactoryOptions,
  error: any,
): ChatCompletionErrorPayload => {
  const errorType = resolveErrorTypes(factory);
  const log = debug(`${runtime.logPrefix}:error`);
  log('handling error: %O', error);

  let desensitizedEndpoint = runtime.baseURL;

  // refs: https://github.com/lobehub/lobe-chat/issues/842
  if (runtime.baseURL !== factory.baseURL) {
    desensitizedEndpoint = desensitizeUrl(runtime.baseURL);
  }

  // Pre-flight context-window failures get a structured payload so the
  // UI can offer fork / switch-model affordances instead of surfacing a
  // raw provider 400. See .
  if (error instanceof ContextExceededPreFlightError) {
    log('pre-flight context exceeded: %s', error.message);
    return AgentRuntimeError.chat({
      endpoint: desensitizedEndpoint,
      error: error.toPayload(),
      errorType: AgentRuntimeErrorType.ExceededContextWindow,
      message: error.message,
      provider: runtime.id,
    });
  }

  if (factory.chatCompletion?.handleError) {
    log('using custom error handler');
    const errorResult = factory.chatCompletion.handleError(error, runtime._options);

    if (errorResult)
      return AgentRuntimeError.chat({
        ...errorResult,
        provider: runtime.id,
      } as ChatCompletionErrorPayload);
  }

  if ('status' in (error as any)) {
    const status = (error as Response).status;
    log('HTTP error with status: %d', status);

    switch (status) {
      case 401: {
        log('invalid API key error');
        return AgentRuntimeError.chat({
          endpoint: desensitizedEndpoint,
          error: error as any,
          errorType: errorType.invalidAPIKey,
          provider: runtime.id,
        });
      }

      case 413: {
        return AgentRuntimeError.chat({
          endpoint: desensitizedEndpoint,
          error: error as any,
          errorType: AgentRuntimeErrorType.RequestBodyTooLarge,
          provider: runtime.id,
        });
      }

      default: {
        break;
      }
    }
  }

  const { errorResult, RuntimeError, message } = handleOpenAIError(error);

  log('error code: %s, message: %s', errorResult.code, errorResult.message);

  switch (errorResult.code) {
    case 'insufficient_quota': {
      log('insufficient quota error');
      return AgentRuntimeError.chat({
        endpoint: desensitizedEndpoint,
        error: errorResult,
        errorType: AgentRuntimeErrorType.InsufficientQuota,
        message,
        provider: runtime.id,
      });
    }

    case 'model_not_found': {
      log('model not found error');
      return AgentRuntimeError.chat({
        endpoint: desensitizedEndpoint,
        error: errorResult,
        errorType: AgentRuntimeErrorType.ModelNotFound,
        message,
        provider: runtime.id,
      });
    }

    // content too long
    case 'context_length_exceeded':
    case 'string_above_max_length': {
      log('context length exceeded error');
      return AgentRuntimeError.chat({
        endpoint: desensitizedEndpoint,
        error: errorResult,
        errorType: AgentRuntimeErrorType.ExceededContextWindow,
        message,
        provider: runtime.id,
      });
    }
  }

  const errorMsg = errorResult.error?.message || errorResult.message;

  if (ErrorClassifier.isAccountDeactivated(errorMsg)) {
    log('account deactivated error detected from message');
    return AgentRuntimeError.chat({
      endpoint: desensitizedEndpoint,
      error: errorResult,
      errorType: AgentRuntimeErrorType.AccountDeactivated,
      message,
      provider: runtime.id,
    });
  }

  if (ErrorClassifier.isInsufficientQuota(errorMsg)) {
    log('insufficient quota error detected from message');
    return AgentRuntimeError.chat({
      endpoint: desensitizedEndpoint,
      error: errorResult,
      errorType: AgentRuntimeErrorType.InsufficientQuota,
      message,
      provider: runtime.id,
    });
  }

  if (ErrorClassifier.isExceededContextWindow(errorMsg)) {
    log('context length exceeded detected from message');
    return AgentRuntimeError.chat({
      endpoint: desensitizedEndpoint,
      error: errorResult,
      errorType: AgentRuntimeErrorType.ExceededContextWindow,
      message,
      provider: runtime.id,
    });
  }

  if (ErrorClassifier.isRateLimitExceeded(errorMsg)) {
    log('quota limit reached detected from message');
    return AgentRuntimeError.chat({
      endpoint: desensitizedEndpoint,
      error: errorResult,
      errorType: AgentRuntimeErrorType.RateLimitExceeded,
      message,
      provider: runtime.id,
    });
  }

  const fallbackErrorType = RuntimeError || errorType.bizError;
  const refinedErrorType = refineErrorCode({
    errorType: String(fallbackErrorType),
    message: typeof errorMsg === 'string' ? errorMsg : undefined,
    provider: runtime.id,
  });

  log('returning generic error');
  return AgentRuntimeError.chat({
    endpoint: desensitizedEndpoint,
    error: errorResult,
    errorType: refinedErrorType ?? fallbackErrorType,
    message,
    provider: runtime.id,
  });
};
