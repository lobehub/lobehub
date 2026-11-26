import type { WebhookSummary, WebhookToolErrorCode } from '../types';
import { WEBHOOK_TOOL_ERROR_CODES } from '../types';

const ERROR_CODES = new Set<WebhookToolErrorCode>(WEBHOOK_TOOL_ERROR_CODES);

export interface WebhookToolError {
  code: WebhookToolErrorCode;
  /** The server's own explanation; shown under the readable title. */
  message?: string;
}

const asCode = (value: unknown): WebhookToolErrorCode =>
  ERROR_CODES.has(value as WebhookToolErrorCode) ? (value as WebhookToolErrorCode) : 'unknown';

/**
 * The failure of a tool call, if it failed. The runtime puts `{ error: { code, message } }` in
 * the state and mirrors it as `pluginError: { type: code, message }`; either is enough, and an
 * unrecognised code reads as `unknown`.
 */
export const getToolError = (
  pluginState: unknown,
  pluginError: unknown,
): WebhookToolError | undefined => {
  const stateError = (pluginState as { error?: { code?: unknown; message?: unknown } } | undefined)
    ?.error;
  if (stateError && typeof stateError === 'object')
    return {
      code: asCode(stateError.code),
      message: typeof stateError.message === 'string' ? stateError.message : undefined,
    };

  if (pluginError && typeof pluginError === 'object') {
    const { message, type } = pluginError as { message?: unknown; type?: unknown };
    return { code: asCode(type), message: typeof message === 'string' ? message : undefined };
  }

  return undefined;
};

/** `plugin` namespace key of the readable title for a failure. */
export const toolErrorTitleKey = (code: WebhookToolErrorCode) =>
  `builtins.lobe-webhook.error.${code}` as const;

/** What "Show details" reveals: the server's own words, then the code support needs. */
export const toolErrorDetails = ({ code, message }: WebhookToolError) =>
  [message?.trim(), `(${code})`].filter(Boolean).join('\n');

/**
 * Whether the card may offer to issue a key: a webhook with a URL that the current user
 * configures. Others cannot get its key (only its creator can), so they are not offered one.
 */
export const canIssueKey = (webhook: Pick<WebhookSummary, 'canConfigure' | 'endpoint'>) =>
  webhook.canConfigure && !!webhook.endpoint;
