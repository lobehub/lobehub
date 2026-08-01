import { type ChatCompletionErrorPayload } from '@lobechat/model-runtime';
import { AGENT_RUNTIME_ERROR_SET } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { createTraceOptions, initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { AicoChatGuard, AicoChatGuardError } from '@/server/services/aico/chatGuard';
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

    if (AicoChatGuard.isManagedProvider(provider) && data.model) {
      const guard = new AicoChatGuard(serverDB);
      await guard.assertModelAllowed(userId, data.model);
    }

    const tracePayload = getTracePayload(req);

    let traceOptions = {};
    // If user enable trace
    if (tracePayload?.enabled) {
      traceOptions = createTraceOptions(data, { provider, trace: tracePayload });
    }

    const response = await modelRuntime.chat(data, {
      user: userId,
      ...traceOptions,
      signal: req.signal,
    });

    if (AicoChatGuard.isManagedProvider(provider)) {
      const guard = new AicoChatGuard(serverDB);

      // Best-effort, non-blocking: bumps trial usage, syncs the active org member's
      // real OpenRouter spend (budget source of truth), and always records a
      // usage_logs row (cost 0 when unknown) — see `AicoChatGuard.afterManagedChat`.
      void guard
        .afterManagedChat(userId, { modelId: data.model || provider })
        .catch((err) =>
          console.error(`[aico] post-chat usage recording failed for [${provider}]:`, err),
        );
    }

    return response;
  } catch (e) {
    if (e instanceof AicoChatGuardError) {
      return createErrorResponse(e.errorType as any, {
        error: e.message,
        provider,
      });
    }

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
