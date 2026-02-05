import type {ChatCompletionErrorPayload} from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { NextResponse } from 'next/server';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { createErrorResponse } from '@/utils/errorResponse';

export const GET = checkAuth(async (req, { params, userId, serverDB }) => {
  const provider = (await params)!.provider!;

  try {
    // Read user's provider config from database
    const agentRuntime = await initModelRuntimeFromDB(serverDB, userId, provider);

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
