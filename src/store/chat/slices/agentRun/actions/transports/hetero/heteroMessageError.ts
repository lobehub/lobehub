import type { HeterogeneousAgentSessionError } from '@lobechat/electron-client-ipc';
import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import {
  buildHeterogeneousAgentAuthRequiredError,
  isHeterogeneousAgentAuthRequired,
  isLocalHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import {
  isEchoedErrorText,
  normalizeHeterogeneousMessageError,
} from '@lobechat/heterogeneous-agents/errors';
import type { ChatMessageError } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';

const maybeClassifyCliAuthRequiredError = (
  error: unknown,
  agentType?: string,
): HeterogeneousAgentSessionError | undefined => {
  if (!agentType || !isLocalHeterogeneousType(agentType)) return;

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : typeof error === 'object' &&
            error &&
            'message' in error &&
            typeof error.message === 'string'
          ? error.message
          : undefined;

  if (!message) return;
  if (!isHeterogeneousAgentAuthRequired(agentType, message)) return;

  return buildHeterogeneousAgentAuthRequiredError({ agentType, stderr: message });
};

/** Whether the streamed text only echoes a terminal CLI error that the error card already shows. */
export const shouldSuppressTerminalErrorEcho = (
  content: string,
  error: ChatMessageError,
): boolean => {
  const errorBody = error.body as
    (HeterogeneousAgentSessionError & { clearEchoedContent?: boolean }) | undefined;
  if (
    !errorBody?.clearEchoedContent &&
    errorBody?.code !== HeterogeneousAgentSessionErrorCode.AuthRequired
  ) {
    return false;
  }

  return isEchoedErrorText(content, errorBody?.stderr || errorBody?.message || error.message);
};

const toRawHeterogeneousAgentMessageError = (
  error: unknown,
  agentType?: string,
): ChatMessageError => {
  const authRequiredError = maybeClassifyCliAuthRequiredError(error, agentType);
  if (authRequiredError) {
    return {
      body: authRequiredError,
      message: authRequiredError.message,
      type: AgentRuntimeErrorType.AgentRuntimeError,
    };
  }

  if (
    typeof error === 'object' &&
    error &&
    'message' in error &&
    typeof error.message === 'string' &&
    ('agentType' in error || 'code' in error || 'docsUrl' in error || 'installCommands' in error)
  ) {
    return {
      body: error as HeterogeneousAgentSessionError,
      message: error.message,
      type: AgentRuntimeErrorType.AgentRuntimeError,
    };
  }

  // A plain `{message}` object (adapter wire data / IPC error envelope)
  // without the session-error marker keys above still carries the only
  // human-readable reason — don't flatten it to the generic fallback.
  const objectMessage =
    typeof error === 'object' && error && 'message' in error && typeof error.message === 'string'
      ? error.message
      : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : (objectMessage ?? 'Agent execution failed');

  // Surface the underlying `cause` (e.g. undici's `ENOTFOUND` / `ECONNREFUSED`
  // hidden under a generic `TypeError: fetch failed`). The desktop IPC layer
  // ferries `cause` across via an error envelope (see `~common/ipcError`).
  // Flatten any Error cause to a plain object — `ChatMessageError.body` is
  // persisted as DB JSONB, where a raw Error would serialize to `{}`.
  const rawCause = error instanceof Error ? error.cause : undefined;
  const cause =
    rawCause instanceof Error
      ? {
          code: (rawCause as { code?: unknown }).code,
          message: rawCause.message,
          name: rawCause.name,
        }
      : rawCause;

  return {
    body: cause === undefined || cause === null ? { message } : { cause, message },
    message,
    type: AgentRuntimeErrorType.AgentRuntimeError,
  };
};

/** The persisted message error for a heterogeneous run failure (CLI auth, session error, plain). */
export const toHeterogeneousAgentMessageError = (
  error: unknown,
  agentType?: string,
): ChatMessageError =>
  normalizeHeterogeneousMessageError(
    toRawHeterogeneousAgentMessageError(error, agentType),
    agentType,
  );
