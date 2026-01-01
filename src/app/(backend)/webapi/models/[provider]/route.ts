import { type ChatCompletionErrorPayload } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { ModelProvider } from 'model-bank';
import { NextResponse } from 'next/server';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import { createErrorResponse } from '@/utils/errorResponse';

const noNeedAPIKey = (provider: string) => [ModelProvider.OpenRouter].includes(provider as any);

export const GET = checkAuth(async (req, { params, jwtPayload }) => {
  const provider = (await params)!.provider!;

  try {
    const hasDefaultApiKey = jwtPayload.apiKey || 'dont-need-api-key-for-model-list';

    const agentRuntime = await initModelRuntimeWithUserPayload(provider, {
      ...jwtPayload,
      apiKey: noNeedAPIKey(provider) ? hasDefaultApiKey : jwtPayload.apiKey,
    });

    const list = await agentRuntime.models();

    return NextResponse.json(list);
  } catch (e) {
    const {
      errorType = ChatErrorType.InternalServerError,
      error: errorContent,
      ...res
    } = e as ChatCompletionErrorPayload;

    const error = errorContent || e;
    // track the error at server side
    console.error(`Route: [${provider}] ${errorType}:`, error);

    // Sanitize error to avoid exposing stack traces to users
    const sanitizedError =
      error instanceof Error ? { message: error.message, name: error.name } : error;

    return createErrorResponse(errorType, { error: sanitizedError, ...res, provider });
  }
});
