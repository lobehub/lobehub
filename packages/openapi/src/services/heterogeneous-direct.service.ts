import type { ChatStreamPayload } from '@lobechat/model-runtime';
import {
  collectStatusCodes,
  getErrorCodeSpec,
  refineErrorCode,
} from '@lobechat/model-runtime/errors';
import { AgentRuntimeErrorType, RequestTrigger } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { ServerDefaultHeterogeneousAgentType } from '@/server/modules/ModelRuntime';
import {
  initModelRuntimeFromServerConfig,
  resolveServerDefaultHeterogeneousModel,
} from '@/server/modules/ModelRuntime';

import { prepareServerDefaultChatPayload } from './heterogeneous-model-payload';

export {
  encodeAnthropicStream,
  encodeResponsesStream,
  normalizeAnthropicRequest,
  normalizeResponsesRequest,
  SERVER_DEFAULT_MODEL_ALIAS,
} from './heterogeneous-direct.protocol';

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
    { userId: params.userId },
  );
  const { deploymentName, supportsAdaptiveThinking } = resolvedModel;
  const model = deploymentName ?? resolvedModel.model;
  const runtime = await initModelRuntimeFromServerConfig({
    actorUserId: params.userId,
    workspaceId: params.workspaceId,
  });
  const payload = prepareServerDefaultChatPayload({
    agentType: params.agentType,
    model: params.model,
    payload: params.payload,
    maxOutput: resolvedModel.maxOutput,
    contextWindowTokens: resolvedModel.contextWindowTokens,
    supportsAdaptiveThinking,
  });
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
