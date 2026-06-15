import type { ChatCompletionErrorPayload } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { NextResponse } from 'next/server';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { createErrorResponse } from '@/utils/errorResponse';

import { resolveValidWorkspaceIdFromRequest } from '../../_utils/workspace';

const getMessageFromError = (error: unknown): string | undefined => {
  if (error === null || error === undefined) return;
  if (typeof error === 'string') return error;

  if (error instanceof Error) {
    if (error.cause instanceof Error && error.cause.message) return error.cause.message;
    return error.message;
  }

  if (typeof error !== 'object') return;

  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
};

const createModelListErrorResponse = (provider: string, e: unknown) => {
  let error = e;
  let errorType: ChatCompletionErrorPayload['errorType'] = ChatErrorType.InternalServerError;
  let rest: Partial<ChatCompletionErrorPayload> = {};

  if (e && typeof e === 'object') {
    const {
      error: errorContent,
      errorType: payloadErrorType,
      ...payloadRest
    } = e as Partial<ChatCompletionErrorPayload>;

    error = errorContent || e;
    errorType = payloadErrorType || errorType;
    rest = payloadRest;
  }

  console.error(`Route: [${provider}] ${errorType}:`, error);

  return createErrorResponse(errorType, {
    error,
    ...rest,
    message: getMessageFromError(error) || getMessageFromError(e) || rest.message,
    provider,
  });
};

export const GET = checkAuth(async (req, { params, userId, serverDB }) => {
  const provider = (await params)!.provider!;

  try {
    const workspaceId = await resolveValidWorkspaceIdFromRequest({ req, serverDB, userId });

    // Read user's provider config from database
    const agentRuntime = await initModelRuntimeFromDB(serverDB, userId, provider, workspaceId);

    const list = await agentRuntime.models();

    return NextResponse.json(list);
  } catch (e) {
    return createModelListErrorResponse(provider, e);
  }
});
