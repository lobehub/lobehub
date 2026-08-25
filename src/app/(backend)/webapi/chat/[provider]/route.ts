import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { isLobeHubModelAvailable } from '@lobechat/business-model-bank/model-config';
import { type ChatCompletionErrorPayload } from '@lobechat/model-runtime';
import { AGENT_RUNTIME_ERROR_SET } from '@lobechat/model-runtime';
import { ChatErrorType, RequestTrigger } from '@lobechat/types';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { UserModel } from '@/database/models/user';
import { createTraceOptions, initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { type ChatStreamPayload } from '@/types/openai/chat';
import { createErrorResponse } from '@/utils/errorResponse';
import { getTracePayload } from '@/utils/trace';

import { resolveValidWorkspaceIdFromRequest } from '../../_utils/workspace';

// If user don't use fluid compute, will build  failed
// this enforce user to enable fluid compute
export const maxDuration = 300;

export const POST = checkAuth(async (req: Request, { params, userId, serverDB }) => {
  const provider = (await params)!.provider!;

  try {
    const workspaceId = await resolveValidWorkspaceIdFromRequest({ req, serverDB, userId });

    // ============  1. init chat model   ============ //
    const modelRuntime = await initModelRuntimeFromDB(serverDB, userId, provider, workspaceId);

    // ============  2. create chat completion   ============ //

    const data = (await req.json()) as ChatStreamPayload;

    // Same gate createImage/createVideo already apply for beta-gated LobeHub
    // models (see isLobeHubModelAvailable) — text chat was the one invocation
    // path that never checked it, so a model hidden from the picker could still
    // be reached by sending its id directly.
    if (
      provider === BRANDING_PROVIDER &&
      !(await isLobeHubModelAvailable(data.model, 'chat', {
        getUserEmail: async () => (await UserModel.findById(serverDB, userId))?.email,
      }))
    ) {
      return createErrorResponse(ChatErrorType.LobeHubModelDeprecated, {
        error: { modelType: 'chat', requestedModel: data.model },
        provider,
      });
    }

    const tracePayload = getTracePayload(req);

    let traceOptions = {};
    // If user enable trace
    if (tracePayload?.enabled) {
      traceOptions = createTraceOptions(data, { provider, trace: tracePayload });
    }

    return await modelRuntime.chat(data, {
      user: userId,
      ...traceOptions,
      // Route-attempt context for business runtimes (router metrics, spend
      // accounting) — mirrors the cloud chat route's metadata contract.
      metadata: {
        provider,
        sessionId: tracePayload?.sessionId,
        topicId: tracePayload?.topicId,
        trigger: RequestTrigger.Chat,
      },
      signal: req.signal,
    });
  } catch (e) {
    const {
      errorType = ChatErrorType.InternalServerError,
      error: errorContent,
      ...res
    } = e as ChatCompletionErrorPayload;

    const error = errorContent || e;

    // track the error at server side
    if (AGENT_RUNTIME_ERROR_SET.has(errorType as string)) {
      console.warn(`Route: [${provider}] ${errorType}:`, error);
    } else {
      console.error(`Route: [${provider}] ${errorType}:`, error);
    }

    return createErrorResponse(errorType, { error, ...res, provider });
  }
});
