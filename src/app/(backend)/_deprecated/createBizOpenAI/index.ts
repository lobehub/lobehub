import { ChatErrorType } from '@lobechat/types';
import type OpenAI from 'openai';

import { getOpenAIAuthFromRequest } from '@/const/fetch';
import { createErrorResponse } from '@/utils/errorResponse';

import { createOpenai } from './createOpenai';

/**
 * @deprecated
 * createOpenAI Instance with Auth and azure openai support
 * if auth not pass ,just return error response
 */
export const createBizOpenAI = (req: Request): Response | OpenAI => {
  const { apiKey, endpoint } = getOpenAIAuthFromRequest(req);

  let openai: OpenAI;

  try {
    openai = createOpenai(apiKey, endpoint);
  } catch (error) {
    if ((error as Error).cause === ChatErrorType.NoOpenAIAPIKey) {
      return createErrorResponse(ChatErrorType.NoOpenAIAPIKey);
    }

    console.error(error); // log error to trace it
    return createErrorResponse(ChatErrorType.InternalServerError);
  }

  return openai;
};
