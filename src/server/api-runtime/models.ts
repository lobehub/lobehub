import type { ChatCompletionErrorPayload, PullModelParams } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { createErrorResponse } from '@/utils/errorResponse';

interface ProviderParams {
  provider: string;
}

const createProviderParams = (provider: string) => Promise.resolve({ provider });

export const modelsAPIHandler = (request: Request, { provider }: ProviderParams) =>
  checkAuth(async (_req, { params, userId, serverDB }) => {
    const routeProvider = (await params).provider!;

    try {
      const agentRuntime = await initModelRuntimeFromDB(serverDB, userId, routeProvider);

      const list = await agentRuntime.models();

      return Response.json(list);
    } catch (error_) {
      const {
        errorType = ChatErrorType.InternalServerError,
        error: errorContent,
        ...res
      } = error_ as ChatCompletionErrorPayload;

      const error = errorContent || error_;
      console.error(`Route: [${routeProvider}] ${errorType}:`, error);

      const sanitizedError =
        error instanceof Error ? { message: error.message, name: error.name } : error;

      return createErrorResponse(errorType, { error: sanitizedError, ...res, provider });
    }
  })(request, { params: createProviderParams(provider) });

export const pullModelsAPIHandler = (request: Request, { provider }: ProviderParams) =>
  checkAuth(async (authedRequest, { params, userId, serverDB }) => {
    const routeProvider = (await params).provider!;

    try {
      const agentRuntime = await initModelRuntimeFromDB(serverDB, userId, routeProvider);

      const data = (await authedRequest.json()) as PullModelParams;

      const response = await agentRuntime.pullModel(data, { signal: authedRequest.signal });
      if (response) return response;

      throw new Error('No response');
    } catch (error_) {
      const {
        errorType = ChatErrorType.InternalServerError,
        error: errorContent,
        ...res
      } = error_ as ChatCompletionErrorPayload;

      const error = errorContent || error_;
      console.error(`Route: [${routeProvider}] ${errorType}:`, error);

      return createErrorResponse(errorType, { error, ...res, provider });
    }
  })(request, { params: createProviderParams(provider) });
