/**
 * Diagnosable, retryable errors for an MCP server that could not be reached
 * while a session was being opened (T-14043).
 *
 * With `versionNegotiation: { mode: 'auto' }` the SDK's first request to an
 * HTTP server is the 2026-07-28 `server/discover` probe. When that request
 * never gets a response, the SDK throws
 * `SdkError(ERA_NEGOTIATION_FAILED, 'Version negotiation probe failed: fetch failed')`
 * and keeps the reason (refused, DNS, timeout, TLS, …) only on the `cause`
 * chain. Callers showed that outer message alone, so every unreachable server
 * read the same, and the probe waited the SDK's 60 s request default.
 *
 * This module bounds the probe, classifies the failure from the cause chain,
 * retries a retryable one once on a fresh session, and reports the endpoint,
 * cause, timeout, attempts and retryability. It is used by the server, device
 * (desktop / `lh connect`) and CLI MCP clients alike.
 *
 * "Unreachable" is a network verdict about the endpoint. It is deliberately a
 * different code from the routing verdicts (`MCP_DEVICE_UNAVAILABLE`,
 * `MCP_BOUND_DEVICE_UNAVAILABLE`), which mean no device that may run the
 * connector is bound or online, so no connection was attempted at all.
 */

/**
 * Upper bound on the version-negotiation probe. Without it the SDK waits its
 * 60 s request default before reporting an endpoint that never answers.
 */
export const MCP_CONNECT_PROBE_TIMEOUT_MS = 15_000;

/** Session-open attempts for an endpoint unreachable for a retryable reason. */
export const MCP_CONNECT_MAX_ATTEMPTS = 2;

/** Pause before the retry, so a server that is just starting can come up. */
export const MCP_CONNECT_RETRY_DELAY_MS = 500;

/** Error code of an MCP endpoint the client could not reach. */
export const MCP_ENDPOINT_UNREACHABLE = 'MCP_ENDPOINT_UNREACHABLE';

/** The `versionNegotiation` option every HTTP MCP client passes to the SDK. */
export const mcpVersionNegotiation = (transport: 'http' | 'stdio') =>
  transport === 'http'
    ? ({ mode: 'auto', probe: { timeoutMs: MCP_CONNECT_PROBE_TIMEOUT_MS } } as const)
    : ({ mode: 'legacy' } as const);

export type McpUnreachableReason =
  'dns' | 'network' | 'refused' | 'reset' | 'timeout' | 'tls' | 'unreachable';

export interface McpConnectFailure {
  /** The innermost system / undici code, e.g. `ECONNREFUSED`. */
  causeCode?: string;
  /** The innermost message, e.g. `connect ECONNREFUSED 127.0.0.1:3845`. */
  causeMessage: string;
  reason: McpUnreachableReason;
  /** Whether trying again can succeed without the user changing anything. */
  retryable: boolean;
}

export interface McpEndpointUnreachableDetails extends McpConnectFailure {
  attempts: number;
  code: typeof MCP_ENDPOINT_UNREACHABLE;
  /**
   * Scheme, host and port of the server. Path, query and credentials are
   * dropped: some servers carry a token in the path, and reachability does
   * not depend on it.
   */
  endpoint: string;
  probeTimeoutMs: number;
  /** Where the connection was made from, e.g. `this device`, `the LobeHub server`. */
  via?: string;
}

const REASON_BY_CODE: Record<string, { reason: McpUnreachableReason; retryable: boolean }> = {
  EADDRNOTAVAIL: { reason: 'unreachable', retryable: true },
  EAI_AGAIN: { reason: 'dns', retryable: true },
  ECONNREFUSED: { reason: 'refused', retryable: true },
  ECONNRESET: { reason: 'reset', retryable: true },
  EHOSTDOWN: { reason: 'unreachable', retryable: true },
  EHOSTUNREACH: { reason: 'unreachable', retryable: true },
  ENETUNREACH: { reason: 'unreachable', retryable: true },
  ENOTFOUND: { reason: 'dns', retryable: false },
  EPIPE: { reason: 'reset', retryable: true },
  ETIMEDOUT: { reason: 'timeout', retryable: true },
  UND_ERR_CLOSED: { reason: 'reset', retryable: true },
  UND_ERR_CONNECT_TIMEOUT: { reason: 'timeout', retryable: true },
  UND_ERR_HEADERS_TIMEOUT: { reason: 'timeout', retryable: true },
  UND_ERR_SOCKET: { reason: 'reset', retryable: true },
};

const isTlsCode = (code: string) =>
  code === 'EPROTO' ||
  code.startsWith('ERR_TLS_') ||
  code.startsWith('ERR_SSL_') ||
  code.includes('CERT') ||
  code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';

const REASON_TEXT: Record<McpUnreachableReason, string> = {
  dns: 'the host name could not be resolved',
  network: 'the request failed before any response arrived',
  refused: 'the connection was refused (nothing is listening at that address)',
  reset: 'the connection was dropped before the server answered',
  timeout: 'the server did not answer in time',
  tls: 'the TLS handshake failed',
  unreachable: 'there is no network route to the host',
};

const REASON_HINT: Record<McpUnreachableReason, string> = {
  dns: 'Check the host name in the connector URL.',
  network: 'Check that the server is running and reachable from there.',
  refused:
    'Start the MCP server (or the app that hosts it) and check the host and port in the connector URL.',
  reset: 'The server or a proxy closed the connection; check the server logs.',
  timeout: 'Check that the server is running and not blocked by a firewall or VPN.',
  tls: 'Fix the server certificate, or use the scheme (http/https) the server actually serves.',
  unreachable:
    'Make sure the machine making the call is on the same network as the server (LAN, VPN).',
};

/** Codes the MCP SDK sets on its own errors, never a network cause. */
const SDK_ERROR_CODES = new Set(['ERA_NEGOTIATION_FAILED', 'REQUEST_TIMEOUT', 'CONNECTION_CLOSED']);

interface ErrorLike {
  cause?: unknown;
  code?: unknown;
  data?: unknown;
  message?: unknown;
  name?: unknown;
}

const chainOf = (error: unknown): ErrorLike[] => {
  const chain: ErrorLike[] = [];
  let current: unknown = error;
  while (current && typeof current === 'object' && chain.length < 10) {
    if (chain.includes(current as ErrorLike)) break;
    chain.push(current as ErrorLike);
    current = (current as ErrorLike).cause;
  }
  return chain;
};

const messageOf = (error: ErrorLike) => (typeof error.message === 'string' ? error.message : '');

/** The already-classified error, when a layer below wrapped one. */
const findUnreachable = (error: unknown): McpEndpointUnreachableError | undefined =>
  chainOf(error).find((link): link is McpEndpointUnreachableError =>
    McpEndpointUnreachableError.isInstance(link),
  );

/**
 * Why an MCP session could not be opened, when the reason is that the endpoint
 * could not be reached. `undefined` for every other failure (HTTP status,
 * authorization, protocol, SSRF policy, stdio), which keep their own handling.
 */
export const classifyMcpConnectFailure = (error: unknown): McpConnectFailure | undefined => {
  const known = findUnreachable(error);
  if (known) {
    const { causeCode, causeMessage, reason, retryable } = known.details;
    return { causeCode, causeMessage, reason, retryable };
  }

  const chain = chainOf(error);
  // The SSRF guard's refusal is a policy decision about the address, handled
  // (and worded) by the server on its own.
  if (chain.some((link) => link.name === 'SSRFBlockedError')) return;

  const innermost = chain.at(-1);
  // The innermost string code is the system / undici one; the SDK's own codes
  // (ERA_NEGOTIATION_FAILED, …) sit on the outer wrapper and say nothing about the network.
  const coded = [...chain]
    .reverse()
    .find((link) => typeof link.code === 'string' && !SDK_ERROR_CODES.has(link.code));
  const code = coded?.code as string | undefined;
  if (code && REASON_BY_CODE[code]) {
    return { causeCode: code, causeMessage: messageOf(coded!), ...REASON_BY_CODE[code] };
  }
  if (code && isTlsCode(code)) {
    return { causeCode: code, causeMessage: messageOf(coded!), reason: 'tls', retryable: false };
  }

  // The probe's own timeout (`SdkError(REQUEST_TIMEOUT)`, HTTP transports only)
  const probeTimeout = chain.find(
    (link) =>
      link.code === 'REQUEST_TIMEOUT' &&
      messageOf(link).startsWith('Version negotiation probe timed out'),
  );
  if (probeTimeout) {
    return {
      causeCode: 'REQUEST_TIMEOUT',
      causeMessage: messageOf(probeTimeout),
      reason: 'timeout',
      retryable: true,
    };
  }

  // A fetch that failed below HTTP without a recognizable code (`TypeError: fetch failed`)
  const fetchFailed = chain.find(
    (link) => link.name === 'TypeError' && /fetch failed|failed to fetch/i.test(messageOf(link)),
  );
  if (fetchFailed) {
    return {
      causeCode: code,
      causeMessage: messageOf(innermost ?? fetchFailed) || messageOf(fetchFailed),
      reason: 'network',
      retryable: true,
    };
  }
};

/** Scheme, host and port of `url`: no path (it can carry a token), query or credentials. */
export const describeMcpEndpoint = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'invalid URL';
  }
};

const formatUnreachableMessage = (details: Omit<McpEndpointUnreachableDetails, 'code'>) => {
  const cause = details.causeCode ? ` (${details.causeCode})` : '';
  const via = details.via ? ` from ${details.via}` : '';
  const retry = details.retryable
    ? 'This is retryable: retry once the server is reachable.'
    : 'Retrying will not help until the configuration is fixed.';
  return (
    `MCP server unreachable at ${details.endpoint}${via}: ${REASON_TEXT[details.reason]}${cause}. ` +
    `${REASON_HINT[details.reason]} ${retry}\n` +
    `(code: ${MCP_ENDPOINT_UNREACHABLE}, reason: ${details.reason}, cause: ${details.causeCode ?? 'unknown'}, ` +
    `endpoint: ${details.endpoint}, attempts: ${details.attempts}, probeTimeoutMs: ${details.probeTimeoutMs}, ` +
    `retryable: ${details.retryable})`
  );
};

const UNREACHABLE_ERROR_MARK = Symbol.for('lobehub.mcpEndpointUnreachable');

/** An MCP endpoint the client could not reach, with everything needed to act on it. */
export class McpEndpointUnreachableError extends Error {
  readonly code = MCP_ENDPOINT_UNREACHABLE;
  readonly details: McpEndpointUnreachableDetails;

  constructor(details: Omit<McpEndpointUnreachableDetails, 'code'>, options?: { cause?: unknown }) {
    super(formatUnreachableMessage(details), options);
    this.name = 'McpEndpointUnreachableError';
    this.details = { ...details, code: MCP_ENDPOINT_UNREACHABLE };
    Object.defineProperty(this, UNREACHABLE_ERROR_MARK, { value: true });
  }

  /** Works across duplicated module copies (bundles), unlike `instanceof`. */
  static isInstance(error: unknown): error is McpEndpointUnreachableError {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as Record<symbol, unknown>)[UNREACHABLE_ERROR_MARK] === true
    );
  }
}

/** The classified unreachable-endpoint error anywhere on `error`'s cause chain. */
export const findMcpEndpointUnreachableError = findUnreachable;

export interface ConnectMcpWithRetryOptions {
  /** The server URL; only its scheme, host and port are reported. */
  endpoint: string;
  maxAttempts?: number;
  /** Called before each retry with the failure that triggered it. */
  onRetry?: (failure: McpConnectFailure, attempt: number) => void;
  probeTimeoutMs?: number;
  retryDelayMs?: number;
  via?: string;
}

/**
 * Open an MCP session with `connect`, retrying on a fresh session when the
 * endpoint was unreachable for a retryable reason, and turn a final
 * unreachable failure into an {@link McpEndpointUnreachableError}. Other
 * failures are rethrown untouched.
 *
 * Safe to retry: an unreachable endpoint received no request, so no tool ran.
 * `connect` must build a new client (and transport) on every call.
 */
export const connectMcpWithRetry = async <T>(
  connect: (attempt: number) => Promise<T>,
  {
    endpoint,
    maxAttempts = MCP_CONNECT_MAX_ATTEMPTS,
    onRetry,
    probeTimeoutMs = MCP_CONNECT_PROBE_TIMEOUT_MS,
    retryDelayMs = MCP_CONNECT_RETRY_DELAY_MS,
    via,
  }: ConnectMcpWithRetryOptions,
): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await connect(attempt);
    } catch (error) {
      const failure = classifyMcpConnectFailure(error);
      if (!failure) throw error;
      if (failure.retryable && attempt < maxAttempts) {
        onRetry?.(failure, attempt);
        if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      throw new McpEndpointUnreachableError(
        {
          ...failure,
          attempts: attempt,
          endpoint: describeMcpEndpoint(endpoint),
          probeTimeoutMs,
          via,
        },
        { cause: error },
      );
    }
  }
};

const UNREACHABLE_TRAILER =
  /\(code: MCP_ENDPOINT_UNREACHABLE, reason: (\w+), cause: ([^,]+), endpoint: (\S+), attempts: (\d+), probeTimeoutMs: (\d+), retryable: (true|false)\)/;

const LEGACY_PROBE_FAILED = /^Version negotiation probe failed: (.+)$/s;
const LEGACY_PROBE_TIMEOUT = /^Version negotiation probe timed out after (\d+)ms/;

/**
 * Recover the unreachable-endpoint details from the text a device sent back.
 * Understands the trailer {@link McpEndpointUnreachableError} writes, and the
 * bare SDK messages of device clients from before it ("Version negotiation
 * probe failed: fetch failed"), for which only the server knows the endpoint.
 */
export const parseMcpEndpointUnreachable = (
  text: string,
  { endpoint, via }: { endpoint?: string; via?: string } = {},
): McpEndpointUnreachableDetails | undefined => {
  const trimmed = text.trim();
  const trailer = UNREACHABLE_TRAILER.exec(trimmed);
  if (trailer) {
    const [, reason, causeCode, reported, attempts, probeTimeoutMs, retryable] = trailer;
    return {
      attempts: Number(attempts),
      causeCode: causeCode === 'unknown' ? undefined : causeCode,
      causeMessage: trimmed.split('\n')[0],
      code: MCP_ENDPOINT_UNREACHABLE,
      endpoint: reported,
      probeTimeoutMs: Number(probeTimeoutMs),
      reason: reason as McpUnreachableReason,
      retryable: retryable === 'true',
      via,
    };
  }

  const timedOut = LEGACY_PROBE_TIMEOUT.exec(trimmed);
  const failed = timedOut ? undefined : LEGACY_PROBE_FAILED.exec(trimmed);
  // "the server answered with an unusable reply" is a protocol problem, not reachability
  if (!timedOut && (!failed || failed[1].startsWith('the server answered'))) return;

  const causeCode = timedOut
    ? 'REQUEST_TIMEOUT'
    : Object.keys(REASON_BY_CODE).find((code) => failed![1].includes(code));
  const classified = causeCode ? REASON_BY_CODE[causeCode] : undefined;
  return {
    attempts: 1,
    causeCode,
    causeMessage: timedOut ? trimmed : failed![1],
    code: MCP_ENDPOINT_UNREACHABLE,
    endpoint: endpoint ? describeMcpEndpoint(endpoint) : 'unknown endpoint',
    probeTimeoutMs: timedOut ? Number(timedOut[1]) : MCP_CONNECT_PROBE_TIMEOUT_MS,
    reason: timedOut ? 'timeout' : (classified?.reason ?? 'network'),
    retryable: timedOut ? true : (classified?.retryable ?? true),
    via,
  };
};

/** The message {@link McpEndpointUnreachableError} would carry for these details. */
export const mcpEndpointUnreachableMessage = (details: McpEndpointUnreachableDetails) =>
  formatUnreachableMessage(details);
