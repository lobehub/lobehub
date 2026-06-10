import { ChatErrorType } from '@lobechat/types';

import { createErrorResponse } from '@/utils/errorResponse';
import { createNodeResponse } from '@/utils/server/response';

export interface CreateSpeechResponseOptions {
  errorContentType?: string;
  logTag: string;
  messages?: {
    failure?: string;
    invalid?: string;
  };
  successContentType?: string;
}

/**
 * Wraps a third-party speech SDK response so the Node.js runtime always receives
 * a valid platform Response, while keeping logging and error handling consistent.
 */
export const createSpeechResponse = async <T>(
  responseCreator: () => Promise<T>,
  {
    logTag,
    successContentType = 'audio/mpeg',
    errorContentType = 'application/json',
    messages,
  }: CreateSpeechResponseOptions,
) => {
  const prefix = `[${logTag}]`;
  const invalidMessage = messages?.invalid ?? 'Unexpected payload from speech provider';
  const failureMessage = messages?.failure ?? 'Failed to synthesize speech';

  return createNodeResponse(responseCreator, {
    error: {
      cacheControl: 'no-store',
      defaultContentType: errorContentType,
    },
    onInvalidResponse: (response) => {
      console.error(`${prefix} ${invalidMessage}`, response);

      return createErrorResponse(ChatErrorType.InternalServerError);
    },
    onNonResponseError: (error) => {
      console.error(`${prefix} ${failureMessage}`, error);

      return createErrorResponse(ChatErrorType.InternalServerError, {
        message: error instanceof Error ? error.message : String(error),
      });
    },
    success: {
      cacheControl: 'no-store',
      defaultContentType: successContentType,
    },
  });
};
