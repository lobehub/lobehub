/**
 * The lifecycle event payload every completion consumer receives.
 */
import { getLlmCallCount } from '@lobechat/agent-runtime';
import { readHeterogeneousErrorContext } from '@lobechat/heterogeneous-agents/errors';

import {
  formatErrorForState,
  readDispatchErrorContext,
  readErrorBudgetContext,
} from '@/server/modules/AgentRuntime/formatErrorForState';

import {
  extractOutboundAttachments,
  extractTextFromMessageContent,
  findLastAssistantMessage,
  normalizeCompletionMessages,
} from './messageContent';

/**
 * Extract a human-readable error message from the agent state error object.
 * Handles both raw `ChatCompletionErrorPayload` (from runtime.step catch) and
 * formatted `ChatMessageError` (from executeStep catch).
 *
 * Public so callers can use the same formatting when surfacing errors
 * outside the hook dispatch path (e.g. trace snapshot finalize).
 */
export function extractErrorMessage(error: any): string | undefined {
  if (!error) return undefined;

  // Path B: formatted ChatMessageError — { body, message, type }
  if (error.body) {
    const body = error.body;
    // OpenAI-style: body.error.message
    if (body.error?.message) return body.error.message;
    if (body.message) return body.message;
  }

  // Path A: raw ChatCompletionErrorPayload — { errorType, error: {...}, provider }
  if (error.error) {
    const inner = error.error;
    if (inner.error?.message) return inner.error.message;
    if (inner.message) return inner.message;
  }

  if (error.message && error.message !== 'error') return error.message;
  if (error.type || error.errorType) return String(error.type || error.errorType);

  return undefined;
}

export function buildLifecycleEvent(
  userId: string,
  operationId: string,
  state: any,
  reason: string,
) {
  const metadata = state?.metadata || {};
  const runOrigin = state?.origin ?? {};
  const messages = normalizeCompletionMessages(
    Array.isArray(state?.messages) ? state.messages : [],
  );

  // Pull text content off the **final** assistant turn. Content may be a
  // plain string or an OpenAI-style multimodal part array; for the array
  // case we concatenate the text parts so the reply body is preserved.
  //
  // We deliberately match on `role === 'assistant'` only — not on whether
  // the turn has any text — so an image-only or tool-output final turn
  // doesn't fall through to an earlier assistant message and ship stale
  // text alongside the current attachments.
  const lastAssistantMessage = findLastAssistantMessage(messages);
  const lastAssistantContent = lastAssistantMessage
    ? extractTextFromMessageContent(lastAssistantMessage.content)
    : undefined;

  // Operation-level metadata only carries `assistantMessageId` on the client
  // runtime path; a server `execAgent` turn leaves it unset (`{}` in DB). Fall
  // back to the persisted id on the final assistant message row in state so the
  // completion event can anchor deferred skill synthesis to this turn (skill
  // synthesis deferred from inbound to turn completion so it uses the full
  // trajectory — tool sequence + final product — not just the user prompt).
  // A metadata value, when present, still wins.
  const assistantMessageId =
    metadata?.assistantMessageId ?? (lastAssistantMessage as { id?: string } | undefined)?.id;

  const attachments = extractOutboundAttachments(messages);

  const duration = state?.createdAt ? Date.now() - new Date(state.createdAt).getTime() : undefined;

  // On the error path, normalize the runtime error once so the lifecycle
  // event carries the stable taxonomy fields (errorType + attribution + the
  // budget context an admission gate attached). Bot reply renderers switch on
  // these to surface a perceivable cause (network / quota / provider outage /
  // which allowance ran out) instead of an opaque Operation ID. Mirrors the
  // same normalization dispatchHooks runs before writing the error onto the
  // assistant message row.
  const formattedError = state?.error ? formatErrorForState(state.error) : undefined;

  return {
    assistantMessageId,
    event: {
      agentId: runOrigin.agentId || '',
      attachments: attachments.length > 0 ? attachments : undefined,
      cost: state?.cost?.total,
      duration,
      errorAttribution: formattedError?.attribution,
      errorBudget: readErrorBudgetContext(formattedError),
      errorHeterogeneous: readHeterogeneousErrorContext(formattedError),
      errorDetail: state?.error,
      errorDispatch: readDispatchErrorContext(formattedError),
      errorMessage: extractErrorMessage(state?.error) || String(state?.error || ''),
      errorType: formattedError?.type === undefined ? undefined : String(formattedError.type),
      finalState: state,
      lastAssistantContent,
      llmCalls: getLlmCallCount(state),
      operationId,
      reason,
      status: state?.status || reason,
      steps: state?.stepCount || 0,
      toolCalls: state?.usage?.tools?.totalCalls,
      topicId: runOrigin.topicId,
      totalTokens: state?.usage?.llm?.tokens?.total,
      userId: runOrigin.userId || userId,
    },
    metadata,
    origin: runOrigin,
  };
}
