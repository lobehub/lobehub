import type { McpEventsToolErrorCode } from '../types';

const ERROR_CODES = new Set<McpEventsToolErrorCode>([
  'callback_unreachable',
  'connector_not_found',
  'delivery_unsupported',
  'events_unsupported',
  'feature_disabled',
  'forbidden',
  'invalid_arguments',
  'limit_reached',
  'not_found',
  'public_url_required',
  'unknown',
]);

export interface McpEventsToolError {
  code: McpEventsToolErrorCode;
  /** The server's own explanation; shown under the readable title. */
  message?: string;
}

const asCode = (value: unknown): McpEventsToolErrorCode =>
  ERROR_CODES.has(value as McpEventsToolErrorCode) ? (value as McpEventsToolErrorCode) : 'unknown';

/**
 * The failure of a tool call, if it failed. The runtime puts
 * `{ error: { code, message } }` in the state and mirrors it as
 * `pluginError: { type: code, message }` (契约 第 6 节); either one is enough,
 * and an unrecognised code reads as `unknown` rather than a missing key.
 */
export const getToolError = (
  pluginState: unknown,
  pluginError: unknown,
): McpEventsToolError | undefined => {
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
export const toolErrorTitleKey = (code: McpEventsToolErrorCode) =>
  `builtins.lobe-mcp-events.error.${code}` as const;

/**
 * What "Show details" reveals: the server's own words, which often name the
 * cause (the APP_URL in use, the connector's reply), then the code support
 * needs to trace it.
 */
export const toolErrorDetails = ({ code, message }: McpEventsToolError) =>
  [message?.trim(), `(${code})`].filter(Boolean).join('\n');
