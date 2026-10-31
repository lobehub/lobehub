import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { AsyncTaskError, AsyncTaskErrorType } from '@lobechat/types';

import { CONTENT_POLICY_ERROR_MESSAGE, getContentPolicyErrorMessage } from './contentPolicyError';

const IMAGE_EDITING_NO_IMAGE_MESSAGE = [
  'The provider did not return an image.',
  'This may be due to content review.',
  'Try a safer source image or a milder prompt.',
].join(' ');
const IMAGE_GENERATION_NO_IMAGE_MESSAGE = [
  'The provider did not return an image.',
  'This may be due to content review.',
  'Try a milder prompt or another model.',
].join(' ');

const MAX_NESTED_ERROR_DEPTH = 3;

/**
 * First upstream message found by walking the `.error` chain, prefixed with the HTTP status.
 *
 * RouterRuntime rethrows the last channel's error as is. A normalized `AgentRuntimeError` has no
 * `.message`; the provider body sits one or two `.error` levels deeper, e.g.
 * `{ errorType: 'UpstreamHttpError', error: { status: 400, error: { message: "Unknown parameter: 'height'." } } }`.
 * Reading only `.message` and `.error.message` stored a bare `ServerError` for these failures.
 */
const getUpstreamErrorMessage = (error: unknown): string | undefined => {
  let current = error;
  let status: number | undefined;

  for (let depth = 0; depth <= MAX_NESTED_ERROR_DEPTH; depth++) {
    if (!current || typeof current !== 'object') return;

    const record = current as { error?: unknown; message?: unknown; status?: unknown };
    if (status === undefined && typeof record.status === 'number') status = record.status;

    if (typeof record.message === 'string' && record.message.length > 0) {
      return status !== undefined && !record.message.startsWith(String(status))
        ? `${status} ${record.message}`
        : record.message;
    }

    current = record.error;
  }
};

interface CategorizeImageGenerationErrorOptions {
  error: ImageGenerationErrorLike;
  isAborted: boolean;
  isEditingImage: boolean;
  providerContentPolicyMessage?: string;
}

interface ImageGenerationErrorLike {
  body?: string | { detail: string };
  error?: {
    error?: unknown;
    message?: string;
    providerReason?: string;
    reasonCode?: string;
    responseId?: string;
    status?: number;
  };
  errorType?: string;
  message?: string;
  name?: string;
  status?: number;
}

interface CategorizedImageGenerationError {
  errorMessage: string;
  errorType: AsyncTaskErrorType;
}

export const categorizeImageGenerationError = ({
  error,
  isAborted,
  isEditingImage,
  providerContentPolicyMessage,
}: CategorizeImageGenerationErrorOptions): CategorizedImageGenerationError => {
  // Handle Comfy UI errors
  if (error.errorType === AgentRuntimeErrorType.ComfyUIServiceUnavailable) {
    return {
      errorMessage:
        error.error?.message || error.message || AgentRuntimeErrorType.ComfyUIServiceUnavailable,
      errorType: AsyncTaskErrorType.InvalidProviderAPIKey,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.ComfyUIBizError) {
    return {
      errorMessage: error.error?.message || error.message || AgentRuntimeErrorType.ComfyUIBizError,
      errorType: AsyncTaskErrorType.ServerError,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.ComfyUIWorkflowError) {
    return {
      errorMessage:
        error.error?.message || error.message || AgentRuntimeErrorType.ComfyUIWorkflowError,
      errorType: AsyncTaskErrorType.ServerError,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.ComfyUIModelError) {
    return {
      errorMessage:
        error.error?.message || error.message || AgentRuntimeErrorType.ComfyUIModelError,
      errorType: AsyncTaskErrorType.ModelNotFound,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.ConnectionCheckFailed) {
    return {
      errorMessage: error.message || AgentRuntimeErrorType.ConnectionCheckFailed,
      errorType: AsyncTaskErrorType.ServerError,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.PermissionDenied) {
    return {
      errorMessage: error.error?.message || error.message || AgentRuntimeErrorType.PermissionDenied,
      errorType: AsyncTaskErrorType.InvalidProviderAPIKey,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.ModelNotFound) {
    return {
      errorMessage: error.error?.message || error.message || AgentRuntimeErrorType.ModelNotFound,
      errorType: AsyncTaskErrorType.ModelNotFound,
    };
  }

  if (providerContentPolicyMessage) {
    return {
      errorMessage: providerContentPolicyMessage,
      errorType: AsyncTaskErrorType.ProviderContentModeration,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.ProviderContentPolicyViolation) {
    return {
      errorMessage: CONTENT_POLICY_ERROR_MESSAGE,
      errorType: AsyncTaskErrorType.ProviderContentModeration,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.ProviderNoImageGenerated) {
    const providerErrorMessage = error.error?.message || error.message;

    if (
      (error.error?.reasonCode === 'google_image_text_only_response' ||
        error.error?.reasonCode === 'google_image_generation_refused') &&
      typeof providerErrorMessage === 'string'
    ) {
      return {
        errorMessage: providerErrorMessage,
        errorType: AsyncTaskErrorType.ServerError,
      };
    }

    return {
      errorMessage: isEditingImage
        ? IMAGE_EDITING_NO_IMAGE_MESSAGE
        : IMAGE_GENERATION_NO_IMAGE_MESSAGE,
      errorType: AsyncTaskErrorType.ServerError,
    };
  }

  // FIXME: 401 errors should be handled in agentRuntime for better practice
  if (error.errorType === AgentRuntimeErrorType.InvalidProviderAPIKey || error?.status === 401) {
    return {
      errorMessage:
        error.error?.message || error.message || AgentRuntimeErrorType.InvalidProviderAPIKey,
      errorType: AsyncTaskErrorType.InvalidProviderAPIKey,
    };
  }

  const fallbackContentPolicyMessage = getContentPolicyErrorMessage(error);
  if (fallbackContentPolicyMessage) {
    return {
      errorMessage: fallbackContentPolicyMessage,
      errorType: AsyncTaskErrorType.ProviderContentModeration,
    };
  }

  if (error instanceof AsyncTaskError) {
    return {
      errorMessage: typeof error.body === 'string' ? error.body : error.body.detail,
      errorType: error.name as AsyncTaskErrorType,
    };
  }

  if (isAborted || error.message?.includes('aborted')) {
    return {
      errorMessage: AsyncTaskErrorType.Timeout,
      errorType: AsyncTaskErrorType.Timeout,
    };
  }

  if (error.message?.includes('timeout') || error.name === 'TimeoutError') {
    return {
      errorMessage: AsyncTaskErrorType.Timeout,
      errorType: AsyncTaskErrorType.Timeout,
    };
  }

  if (error.message?.includes('network') || error.name === 'NetworkError') {
    return {
      errorMessage: error.message || AsyncTaskErrorType.ServerError,
      errorType: AsyncTaskErrorType.ServerError,
    };
  }

  return {
    errorMessage: getUpstreamErrorMessage(error) || AsyncTaskErrorType.ServerError,
    errorType: AsyncTaskErrorType.ServerError,
  };
};
