import type { McpEventsToolErrorCode } from '@lobechat/builtin-tool-mcp-events';
import { isRecord } from '@lobechat/utils/object';

import { getMcpEventErrorName } from '@/libs/mcp/events/errors';
import { getMCPConnectionErrorType } from '@/libs/mcp/utils';

export class McpEventsServiceError extends Error {
  constructor(
    public readonly code: McpEventsToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'McpEventsServiceError';
  }
}

export function isMcpAuthError(error: unknown): boolean {
  if (getMcpEventErrorName(error) === 'Forbidden') return true;
  const visited = new Set<unknown>();
  let current = error;
  while (isRecord(current) && !visited.has(current)) {
    visited.add(current);
    if (getMCPConnectionErrorType(current) === 'AUTHORIZATION_ERROR') return true;
    if (current.status === 401 || current.statusCode === 401 || current.code === 401) return true;
    current = current.cause;
  }
  return false;
}

export function mapMcpEventsError(error: unknown): McpEventsServiceError {
  if (error instanceof McpEventsServiceError) return error;
  if (isMcpAuthError(error))
    return new McpEventsServiceError(
      'forbidden',
      'Reconnect this connector to subscribe to events.',
    );
  const mapped = {
    Unsupported: ['delivery_unsupported', 'This event does not support webhook delivery.'],
    NotFound: ['events_unsupported', 'This event type is no longer available.'],
    InvalidParams: ['invalid_arguments', 'The event subscription arguments are invalid.'],
    CallbackEndpointError: [
      'callback_unreachable',
      'The MCP server could not verify the callback endpoint.',
    ],
    ResourceExhausted: ['limit_reached', 'The MCP server subscription limit has been reached.'],
  } as const;
  const name = getMcpEventErrorName(error);
  const entry = name && name in mapped ? mapped[name as keyof typeof mapped] : undefined;
  return entry
    ? new McpEventsServiceError(entry[0], entry[1])
    : new McpEventsServiceError('unknown', 'Could not contact the MCP event server.');
}
