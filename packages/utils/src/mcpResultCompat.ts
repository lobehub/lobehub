import { isRecord } from './object';

/**
 * Tolerance for MCP servers that negotiate protocol revision 2026-07-28 but
 * leave out the caching hints it requires on cacheable results (`ttlMs`,
 * `cacheScope`, SEP-2549), such as servers built on a draft of that revision.
 * The SDK's modern codec rejects such a result outright, so one missing hint
 * fails the whole `tools/list`, and with it a connector's add or refresh.
 *
 * Installed on a client transport before `connect`, it fills a missing or
 * invalid hint with the value the SDK itself assumes for an absent one
 * (`ttlMs: 0`, i.e. immediately stale, and `cacheScope: 'private'`) and
 * reports a warning instead. It also keeps a short excerpt of each list
 * method's last raw result, so an error the SDK still raises for one (a
 * malformed tool, say) can show what the server actually sent.
 */

/** The 2026-07-28 results that carry `ttlMs` / `cacheScope`. */
const CACHEABLE_METHODS = new Set([
  'prompts/list',
  'resources/list',
  'resources/read',
  'resources/templates/list',
  'tools/list',
]);

/** Results worth quoting in an error: listings, never resource contents. */
const EXCERPT_METHODS = new Set([
  'prompts/list',
  'resources/list',
  'resources/templates/list',
  'tools/list',
]);

const RAW_EXCERPT_LENGTH = 600;

/** Bound on in-flight requests tracked, for requests that never get a reply. */
const MAX_TRACKED_REQUESTS = 200;

/** The SDK's `SdkErrorCode.InvalidResult`. */
const INVALID_RESULT_CODE = 'INVALID_RESULT';

type RequestId = number | string;

/** The part of an MCP SDK client transport this patches. */
export interface McpResultCompatTransport {
  onmessage?: (message: any, extra?: any) => void;
  send: (message: any, options?: any) => Promise<void>;
}

export interface McpResultCompat {
  /** A truncated JSON excerpt of the last raw result of `method`, when one arrived. */
  rawResultExcerpt: (method: string) => string | undefined;
}

export interface McpResultCompatOptions {
  /** Called once per method when a result's caching hints had to be filled in. */
  onWarning?: (message: string) => void;
}

const isValidTtl = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Fill in missing or invalid caching hints in place; returns the fields it set. */
const fillCacheHints = (result: Record<string, unknown>): string[] => {
  const filled: string[] = [];
  if (!isValidTtl(result.ttlMs)) {
    result.ttlMs = 0;
    filled.push('ttlMs');
  }
  if (result.cacheScope !== 'public' && result.cacheScope !== 'private') {
    result.cacheScope = 'private';
    filled.push('cacheScope');
  }
  return filled;
};

const excerptOf = (result: unknown): string => {
  let text: string;
  try {
    text = JSON.stringify(result) ?? String(result);
  } catch {
    text = String(result);
  }
  return text.length > RAW_EXCERPT_LENGTH ? `${text.slice(0, RAW_EXCERPT_LENGTH)}…` : text;
};

/**
 * Patch `transport` so cacheable results missing their caching hints still
 * parse. Call it before the client connects: the client chains a pre-set
 * `onmessage`, and its version-negotiation probe restores it afterwards.
 */
export const installMcpResultCompat = (
  transport: McpResultCompatTransport,
  { onWarning }: McpResultCompatOptions = {},
): McpResultCompat => {
  const pendingMethods = new Map<RequestId, string>();
  const rawExcerpts = new Map<string, string>();
  const warnedMethods = new Set<string>();

  if (typeof transport.send === 'function') {
    const send = transport.send.bind(transport);
    transport.send = (message, options) => {
      if (
        isRecord(message) &&
        (typeof message.id === 'number' || typeof message.id === 'string') &&
        typeof message.method === 'string' &&
        CACHEABLE_METHODS.has(message.method)
      ) {
        pendingMethods.set(message.id, message.method);
        if (pendingMethods.size > MAX_TRACKED_REQUESTS) {
          const oldest = pendingMethods.keys().next().value;
          if (oldest !== undefined) pendingMethods.delete(oldest);
        }
      }
      return send(message, options);
    };
  }

  const handleMessage = (message: unknown) => {
    if (!isRecord(message) || !('result' in message) || message.id === undefined) return;
    const method = pendingMethods.get(message.id as RequestId);
    if (!method) return;
    pendingMethods.delete(message.id as RequestId);

    const { result } = message;
    if (EXCERPT_METHODS.has(method)) rawExcerpts.set(method, excerptOf(result));

    // Only a 2026-07-28 result (it carries `resultType`) is held to the hints;
    // an earlier revision's result passes without them.
    if (!isRecord(result) || typeof result.resultType !== 'string') return;
    if (result.resultType !== 'complete') return;

    const filled = fillCacheHints(result);
    if (filled.length === 0 || warnedMethods.has(method)) return;
    warnedMethods.add(method);
    onWarning?.(
      `The MCP server's ${method} result is missing or has invalid ${filled.join(', ')} (required since MCP protocol 2026-07-28); using ttlMs=0 and cacheScope="private" instead.`,
    );
  };

  const preset = transport.onmessage;
  transport.onmessage = (message, extra) => {
    try {
      handleMessage(message);
    } catch {
      // Never let the compatibility shim drop a message.
    }
    preset?.(message, extra);
  };

  return {
    rawResultExcerpt: (method) => rawExcerpts.get(method),
  };
};

/**
 * An SDK `INVALID_RESULT` error for `method`, with the server's raw result
 * appended so the failure can be diagnosed; any other error as it is.
 */
export const withMcpRawResult = (
  error: unknown,
  compat: McpResultCompat | undefined,
  method: string,
): unknown => {
  if (!(error instanceof Error) || (error as { code?: unknown }).code !== INVALID_RESULT_CODE) {
    return error;
  }
  const excerpt = compat?.rawResultExcerpt(method);
  if (!excerpt) return error;
  return new Error(`${error.message}\nServer response (truncated): ${excerpt}`, { cause: error });
};
