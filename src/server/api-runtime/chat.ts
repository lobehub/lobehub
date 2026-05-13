import type { ChatCompletionErrorPayload } from '@lobechat/model-runtime';
import { AGENT_RUNTIME_ERROR_SET } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { createTraceOptions, initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import type { ChatStreamPayload } from '@/types/openai/chat';
import { createErrorResponse } from '@/utils/errorResponse';
import { getTracePayload } from '@/utils/trace';

interface ProviderParams {
  provider: string;
}

const createProviderParams = (provider: string) => Promise.resolve({ provider });

export const chatAPIHandler = (request: Request, { provider }: ProviderParams) =>
  checkAuth(async (authedRequest, { params, userId, serverDB }) => {
    const routeProvider = (await params).provider!;

    try {
      const modelRuntime = await initModelRuntimeFromDB(serverDB, userId, routeProvider);

      const data = (await authedRequest.json()) as ChatStreamPayload;

      const tracePayload = getTracePayload(authedRequest);

      let traceOptions = {};
      if (tracePayload?.enabled) {
        traceOptions = createTraceOptions(data, { provider: routeProvider, trace: tracePayload });
      }

      return await modelRuntime.chat(data, {
        user: userId,
        ...traceOptions,
        signal: authedRequest.signal,
      });
    } catch (error_) {
      const {
        errorType = ChatErrorType.InternalServerError,
        error: errorContent,
        ...res
      } = error_ as ChatCompletionErrorPayload;

      const error = errorContent || error_;

      const logMethod = AGENT_RUNTIME_ERROR_SET.has(errorType as string) ? 'warn' : 'error';
      // eslint-disable-next-line no-console
      console[logMethod](`Route: [${routeProvider}] ${errorType}:`, error);

      return createErrorResponse(errorType, { error, ...res, provider: routeProvider });
    }
  })(request, { params: createProviderParams(provider) });
