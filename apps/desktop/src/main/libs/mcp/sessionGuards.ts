import { SdkError, SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client';

import type { MCPClientParams } from './types';

/**
 * Serialize MCP client params into a stable cache key. Object keys are
 * canonicalized (sorted) so that key order in the manifest does not defeat
 * reuse, while array order is preserved: CLI argv is positional, and sorting
 * `args` would let distinct invocations made of the same tokens (reordered
 * flags / positional arguments) silently share a session launched with the
 * previous command line. `env` participates in the key: a changed
 * secret/config must spawn a fresh session rather than reuse one
 * authenticated with the old values.
 */
const canonicalizeForCacheKey = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => canonicalizeForCacheKey(item));
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalizeForCacheKey(source[key]);
    }
    return sorted;
  }
  return value;
};

export const serializeMcpClientParams = (params: MCPClientParams): string =>
  JSON.stringify(canonicalizeForCacheKey(params as unknown as Record<string, unknown>));

/**
 * Whether a failed `callTool` is a confirmed stale-session / transport-level
 * failure, i.e. safe to retry on a fresh session. App-level tool failures
 * (the tool ran and rejected the arguments, the server returned an error
 * result, post-processing failed, …) must NOT be retried: a mutating tool
 * could apply its side effect (write / delete / send) a second time.
 *
 * The signal set is deliberately narrow and mirrors the server-side
 * `MCPClient.isNoValidSessionError` (src/libs/mcp/client.ts): only the
 * `MCPConnectionError` transport wrapper, HTTP 404, or the legacy
 * "No valid session ID provided" message qualify. Generic JSON-RPC `-32000`
 * errors are server-side application errors and do NOT trigger a retry.
 */
export const isStaleSessionError = (error: unknown, era?: 'modern' | 'legacy'): boolean => {
  if (era === 'modern') return false;
  if (!error) return false;
  if (SdkHttpError.isInstance(error) && error.status === 404) return true;
  if (error instanceof Error && error.name === 'MCPConnectionError') return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('No valid session ID provided');
};

/**
 * Whether the failure means the pooled stdio subprocess is gone. The MCP
 * SDK surfaces a dead transport as `SdkError(SdkErrorCode.ConnectionClosed)`
 * for requests that were in flight when the process exited, and as
 * `SdkError(SdkErrorCode.NotConnected)` for requests issued after close.
 *
 * Unlike `isStaleSessionError` this does NOT authorize a replay — the
 * request may have reached the server before the pipe died — but the dead
 * client must still be evicted from the pool, or every later same-key
 * acquisition would refresh and return the same unusable session forever.
 * SDK error brands and codes keep server-side application errors from
 * evicting a healthy pooled session.
 */
export const isDeadTransportError = (error: unknown): boolean =>
  SdkError.isInstance(error) &&
  (error.code === SdkErrorCode.ConnectionClosed || error.code === SdkErrorCode.NotConnected);
