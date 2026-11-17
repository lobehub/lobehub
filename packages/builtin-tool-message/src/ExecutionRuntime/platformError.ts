import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

/** Why a chat platform refused a call, in terms the model can act on. */
export interface MessagePlatformErrorData {
  /** Stable machine code, e.g. `DISCORD_MISSING_ACCESS`. */
  code: string;
  /** What to do next. The model reads it together with the message. */
  hint: string;
  /** `stop` when retrying or switching targets cannot help; `replan` when a different argument can. */
  kind: 'replan' | 'stop';
  /** What failed and why, naming the channel or server involved. */
  message: string;
  /** The platform's own error code, e.g. Discord `50001`. */
  platformCode?: number | string;
  /** The HTTP status the platform answered with. */
  status?: number;
}

/**
 * Thrown by a platform adapter when it can name the reason for a refusal (no access to a
 * channel, a missing permission, an unknown id), so the failed tool call carries that reason
 * instead of the platform's bare wording ("Missing Access").
 */
export class MessagePlatformError extends Error {
  readonly data: MessagePlatformErrorData;

  constructor(data: MessagePlatformErrorData) {
    super(data.message);
    this.name = 'MessagePlatformError';
    this.data = data;
  }
}

const getPlatformErrorData = (error: unknown): MessagePlatformErrorData | undefined =>
  error instanceof MessagePlatformError ? error.data : undefined;

/**
 * The output of a failed channel operation. A platform-explained refusal also carries its
 * structured reason as `error`, and its hint joins the text the model reads.
 */
export const toFailureOutput = (operation: string, error: unknown): BuiltinServerRuntimeOutput => {
  const message = error instanceof Error ? error.message : String(error);
  const data = getPlatformErrorData(error);
  if (!data) return { content: `${operation} error: ${message}`, success: false };

  return { content: `${operation} error: ${message} ${data.hint}`, error: data, success: false };
};
