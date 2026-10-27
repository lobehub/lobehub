import { toRecord } from '@lobechat/utils/object';
import { SdkHttpError, UnauthorizedError } from '@modelcontextprotocol/client';

/** Bounds the `cause` walk so a self-referencing error cannot loop forever. */
const MAX_CAUSE_DEPTH = 5;

/**
 * Whether an MCP call failed because the server rejected its credentials.
 *
 * SDK HTTP errors carry the status in `.status`; OAuth failures use
 * `UnauthorizedError`. MCPService wraps these in a TRPCError, so inspect
 * the bounded cause chain instead of matching message text.
 * `MCPClient.initialize` may also have already mapped it to an
 * `AUTHORIZATION_ERROR`.
 */
export const isMcpAuthorizationError = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth++) {
    const record = toRecord(current);
    if (!record) return false;
    if (
      (SdkHttpError.isInstance(current) && current.status === 401) ||
      UnauthorizedError.isInstance(current)
    )
      return true;
    if (toRecord(record.data)?.type === 'AUTHORIZATION_ERROR') return true;
    current = record.cause;
  }
  return false;
};

/**
 * Model-visible content for an MCP credential rejection. The raw transport
 * error says nothing about who owns the connection, so models guessed and told
 * Agent Share visitors to "reauthorize in the browser" — but a shared run
 * executes with a connection from the creator's side (theirs, or one a
 * workspace member authorized), which the visitor can neither see nor repair.
 */
export const buildMcpAuthorizationErrorContent = (
  identifier: string,
  options: { isShareVisitor: boolean },
): string =>
  options.isShareVisitor
    ? `The '${identifier}' connection was set up on this agent creator's side (by the creator or a member of their workspace), and its authorization has expired or been revoked. The person in this shared conversation cannot reconnect it and has no sign-in or authorization option here. Tell them this tool is unavailable until the agent's creator (or whoever manages this connection for them) reconnects it. They cannot do it themselves, so do not ask them to sign in, authorize, or reconnect anything, and continue with what you can do without this tool.`
    : `The '${identifier}' connection's authorization has expired or been revoked (HTTP 401). Ask the user to reconnect '${identifier}' in their tool or connector settings, then retry.`;
