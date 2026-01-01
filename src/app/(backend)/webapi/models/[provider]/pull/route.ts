import { type ChatCompletionErrorPayload, type PullModelParams } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import { createErrorResponse } from '@/utils/errorResponse';

export const POST = checkAuth(async (req, { params, jwtPayload }) => {
  const provider = (await params)!.provider!;

  try {
    const agentRuntime = await initModelRuntimeWithUserPayload(provider, jwtPayload);

    const data = (await req.json()) as PullModelParams;

    const res = await agentRuntime.pullModel(data, { signal: req.signal });
    if (res) return res;

    throw new Error('No response');
  } catch (e) {
    const {
      errorType = ChatErrorType.InternalServerError,
      error: errorContent,
      ...res
    } = e as ChatCompletionErrorPayload;

    const error = errorContent || e;
    // track the error at server side
    console.error(`Route: [${provider}] ${errorType}:`, error);

    return createErrorResponse(errorType, { error, ...res, provider });
  }
});
