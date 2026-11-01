import type { ChatStreamPayload } from '@lobechat/model-runtime';
import {
  collectStatusCodes,
  getErrorCodeSpec,
  refineErrorCode,
} from '@lobechat/model-runtime/errors';
import { parseClaudeModelId } from '@lobechat/model-runtime/providers/anthropic/modelId';
import { isResponsesAPIModel } from '@lobechat/model-runtime/providers/openai/modelId';
import { normalizeAnthropicToolSchema } from '@lobechat/model-runtime/utils/anthropicToolSchema';
import type { CodexReasoningEffort } from '@lobechat/types';
import {
  AgentRuntimeErrorType,
  getCodexReasoningEffortLevels,
  RequestTrigger,
  SERVER_DEFAULT_HETEROGENEOUS_MODEL_ALIAS,
} from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { ServerDefaultHeterogeneousAgentType } from '@/server/modules/ModelRuntime';
import {
  initModelRuntimeFromServerConfig,
  resolveServerDefaultHeterogeneousModel,
} from '@/server/modules/ModelRuntime';

export const SERVER_DEFAULT_MODEL_ALIAS = SERVER_DEFAULT_HETEROGENEOUS_MODEL_ALIAS;

export {
  normalizeAnthropicRequest,
  normalizeResponsesRequest,
} from './heterogeneous-direct.request';
export { encodeResponsesStream } from './heterogeneous-direct.responses';
export { encodeAnthropicStream } from './heterogeneous-direct.stream';

export const invokeServerDefaultModel = async (params: {
  agentType: ServerDefaultHeterogeneousAgentType;
  model: string;
  payload: ChatStreamPayload;
  signal: AbortSignal;
  userId: string;
  workspaceId?: string;
}) => {
  const resolvedModel = await resolveServerDefaultHeterogeneousModel(
    params.agentType,
    params.model,
  );
  const { deploymentName, maxOutput, supportsAdaptiveThinking } = resolvedModel;
  const model = deploymentName ?? resolvedModel.model;
  const runtime = await initModelRuntimeFromServerConfig({
    actorUserId: params.userId,
    workspaceId: params.workspaceId,
  });
  const normalizedPayload = { ...params.payload };
  // OpenAI-compatible routers can also select Claude. Normalize before routing,
  // using the logical model rather than an opaque provider deployment alias.
  if (parseClaudeModelId(resolvedModel.model) || parseClaudeModelId(params.model)) {
    normalizedPayload.tools = normalizedPayload.tools?.map((tool) => ({
      ...tool,
      function: {
        ...tool.function,
        parameters: normalizeAnthropicToolSchema(tool.function.parameters),
      },
    }));
  }
  // Kimi can use its context window as the output budget for an unknown model.
  // Bound that budget by the selected deployment model, including for older clients.
  if (params.agentType === 'kimi-code' && maxOutput !== undefined && maxOutput > 0) {
    normalizedPayload.max_tokens = Math.min(normalizedPayload.max_tokens ?? maxOutput, maxOutput);
  }
  if (
    params.agentType === 'claude-code' &&
    normalizedPayload.thinking?.type === 'adaptive' &&
    !supportsAdaptiveThinking
  ) {
    delete normalizedPayload.thinking;
  }
  const { reasoning, ...chatCompletionsPayload } = normalizedPayload;
  const requestedReasoningEffort = reasoning?.effort;
  const reasoningEffort = getCodexReasoningEffortLevels(params.model).includes(
    requestedReasoningEffort as CodexReasoningEffort,
  )
    ? (requestedReasoningEffort as ChatStreamPayload['reasoning_effort'])
    : undefined;
  const routedReasoningEffort =
    normalizedPayload.reasoning_effort ??
    (requestedReasoningEffort as ChatStreamPayload['reasoning_effort']);
  // Responses describes the CLI-facing ingress, not necessarily the selected provider's API.
  // Keep it upstream only for native Codex models; the deployment router owns every other choice.
  let payload = {
    ...chatCompletionsPayload,
    ...(routedReasoningEffort ? { reasoning_effort: routedReasoningEffort } : {}),
  };
  if (params.agentType === 'codex') {
    payload = isResponsesAPIModel(params.model)
      ? { ...normalizedPayload, apiMode: 'responses' }
      : {
          ...chatCompletionsPayload,
          apiMode: 'chatCompletion' as const,
          reasoning_effort: normalizedPayload.reasoning_effort ?? reasoningEffort,
        };
  }
  const response = await runtime.chat(
    {
      ...payload,
      model,
      stream: true,
    },
    { metadata: { trigger: RequestTrigger.Api }, signal: params.signal, user: params.userId },
  );
  if (!response.body) throw new Error('Model runtime returned an empty stream');
  return { model, response };
};

const readMessage = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return undefined;
  if (typeof value.message === 'string') return value.message;
  return undefined;
};

/**
 * Describe a failed relay in terms its caller can act on.
 *
 * `runtime.chat` rejects with a plain `{ error, errorType, provider }` object
 * rather than an `Error`. Keep its readable body, but do not turn known terminal
 * failures into retryable 502s. Unclassified failures still use 502 because some
 * adapters discard the original upstream status.
 */
export const describeRelayFailure = (error: unknown) => {
  const payload = isRecord(error) ? error : undefined;
  const message =
    readMessage(payload) ??
    readMessage(payload?.error) ??
    (payload?.error === undefined ? undefined : JSON.stringify(payload.error)) ??
    String(error);
  const provider = typeof payload?.provider === 'string' ? payload.provider : undefined;
  const errorType = payload?.errorType;
  // Only provider wrappers use the SDK convention of a leading HTTP status.
  const messageStatus =
    errorType === AgentRuntimeErrorType.ProviderBizError ||
    errorType === AgentRuntimeErrorType.UpstreamHttpError
      ? Number(/^\s*([45]\d{2})\b/.exec(message)?.[1])
      : undefined;
  const httpStatus = [errorType, payload?.status, ...collectStatusCodes(error), messageStatus].find(
    (value): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599,
  );
  const refinedCode = refineErrorCode({
    errorType: errorType === undefined ? undefined : String(errorType),
    httpStatus,
    message,
    provider,
  });
  const spec = getErrorCodeSpec(refinedCode ?? String(errorType));
  // Generic provider buckets defer to HTTP semantics; other categories keep their
  // explicit retry policy even when marked as monitoring fallbacks.
  const classified = spec && !(spec.isFallback && spec.category === 'provider');
  const candidateStatus = httpStatus ?? (classified ? spec.httpStatus : 502);
  // Runtime-only 470/471/472 codes are not public HTTP protocol statuses.
  const status = (
    [470, 471, 472].includes(candidateStatus)
      ? classified && !spec.retryable
        ? 400
        : 502
      : candidateStatus
  ) as ContentfulStatusCode;
  // Providers can reuse request-error phrases in transient responses. Let HTTP
  // semantics win over those inferences, but retain explicit types and quota policy.
  const inferredRequestError = refinedCode !== undefined && spec?.category === 'request';

  return {
    // Never empty. A blank message here would put the caller back where the
    // bodyless 500 left it — a failure with no way to tell what failed — and
    // `String(error)` is blank for a thrown empty string.
    message:
      [provider && `[${provider}]`, errorType && `${String(errorType)}:`, message]
        .filter(Boolean)
        .join(' ')
        .trim() || 'Model runtime failed without a message',
    retryable:
      classified && !inferredRequestError
        ? spec.retryable
        : status >= 500 || [408, 409, 429].includes(status),
    status,
  };
};
