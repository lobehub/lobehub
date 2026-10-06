import { type ChatCompletionErrorPayload, type PullModelParams } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { initModelRuntimeForRequest } from '@/server/modules/AgentRuntime/llmRelay/oneShot';
import { runRouteWithLlmRelayRequest } from '@/server/modules/AgentRuntime/llmRelay/requestScope';
import { createErrorResponse } from '@/utils/errorResponse';

import { resolveValidWorkspaceIdFromRequest } from '../../../_utils/workspace';

export const POST = checkAuth(async (req, { params, userId, serverDB }) => {
  const provider = (await params)!.provider!;

  try {
    const workspaceId = await resolveValidWorkspaceIdFromRequest({ req, serverDB, userId });

    // A provider only the user's device reaches (Ollama) downloads through the
    // requesting tab (one-shot relay); the channel stays open while progress streams.
    return await runRouteWithLlmRelayRequest(req, userId, async () => {
      // Read user's provider config from database
      const agentRuntime = await initModelRuntimeForRequest(serverDB, userId, provider, {
        workspaceId,
      });

      const data = (await req.json()) as PullModelParams;

      const res = await agentRuntime.pullModel(data, { signal: req.signal });
      if (res) return res;

      throw new Error('No response');
    });
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
