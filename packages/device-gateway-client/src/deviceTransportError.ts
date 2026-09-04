/**
 * Human- and model-readable descriptions for device-channel transport
 * failures.
 *
 * Every call to a user's device travels cloud → gateway → device WebSocket, and
 * that hop fails on its own schedule: the desktop app sleeps, the socket
 * reconnects, a long command outruns the deadline. The client used to hand the
 * raw status straight through — `Device tool call failed (HTTP 503)` — which is
 * the least useful sentence available to either reader:
 *
 * - The **model** cannot tell a transport failure from a tool that genuinely
 *   refused, so it either gives up on a device that is one retry away from
 *   answering, or blindly re-runs a mutating command that may still be running.
 * - The **user** sees a bare status code in the tool card with no hint that the
 *   thing to check is their own desktop app.
 *
 * So each status is mapped to a stable code plus a sentence that says what
 * happened, whether the call reached the device, and what to do next. The
 * gateway's own body text is preserved verbatim in `error` — downstream still
 * matches on codes like `DEVICE_OFFLINE`.
 */

export const DeviceTransportErrorCode = {
  /** Gateway reachable, device not: offline, asleep, or mid-reconnect. */
  DeviceChannelUnavailable: 'DEVICE_CHANNEL_UNAVAILABLE',
  /** The gateway has no record of the addressed device. */
  DeviceNotFound: 'DEVICE_NOT_FOUND',
  /** Delivered to the device, but no answer before the deadline. */
  DeviceResponseTimeout: 'DEVICE_RESPONSE_TIMEOUT',
  /** The gateway itself failed (5xx that is not a routing failure). */
  GatewayError: 'DEVICE_GATEWAY_ERROR',
  /** The request was malformed or rejected by the gateway (4xx). */
  GatewayRejected: 'DEVICE_GATEWAY_REJECTED',
  /** The cloud could not open a connection to the gateway at all. */
  GatewayUnreachable: 'DEVICE_GATEWAY_UNREACHABLE',
  /** Gateway throttled this caller. */
  RateLimited: 'DEVICE_GATEWAY_RATE_LIMITED',
  /** The service token was rejected. */
  Unauthorized: 'DEVICE_GATEWAY_UNAUTHORIZED',
} as const;

export type DeviceTransportErrorCode =
  (typeof DeviceTransportErrorCode)[keyof typeof DeviceTransportErrorCode];

export interface DeviceTransportFailure {
  code: DeviceTransportErrorCode;
  /** LLM- and user-facing explanation. Goes in the result `content`. */
  content: string;
  /** Machine-facing detail: the gateway's own body when it sent one. */
  error: string;
}

/** What the failed hop was carrying, used to open the sentence. */
export type DeviceTransportOperation = 'tool call' | 'message API call' | 'RPC call' | 'agent run';

const RECONNECT_HINT = `Tell the user to check that the LobeHub desktop app (or the \`lh\` CLI) is running and shows as connected.`;

const describeStatus = (
  status: number,
  operation: DeviceTransportOperation,
): { code: DeviceTransportErrorCode; content: string } => {
  switch (true) {
    // The gateway is up but could not hand the call to the device. The device
    // never ran it, so a retry is safe even for a mutating call.
    case status === 502 || status === 503: {
      return {
        code: DeviceTransportErrorCode.DeviceChannelUnavailable,
        content: `The device is not reachable right now, so this ${operation} never ran on it (gateway responded HTTP ${status}). The device connection dropped, went to sleep, or is mid-reconnect — this is a connection problem, not a failure of the requested operation. Nothing was executed, so retrying the same call is safe: wait a few seconds, then retry up to 8 times for this operation. If it still fails, stop retrying it and replan. ${RECONNECT_HINT}`,
      };
    }

    // Delivered, but unanswered before the deadline. Critically different from
    // 503: the device may still be executing, so a blind retry can double-apply.
    case status === 504: {
      return {
        code: DeviceTransportErrorCode.DeviceResponseTimeout,
        content: `The device received this ${operation} but did not answer before the deadline (gateway responded HTTP ${status}). The work may still be running on the device, so do NOT blindly repeat anything that writes or has side effects — first check the current state (re-read the file, list the directory, or check the process) and retry only if the change clearly did not happen and the operation is safe to repeat. Long-running commands should be started in the background and polled instead.`,
      };
    }

    case status === 404: {
      return {
        code: DeviceTransportErrorCode.DeviceNotFound,
        content: `The gateway has no connected device matching this ${operation}'s target (gateway responded HTTP ${status}). The device was never registered, or it disconnected and its session was dropped. Re-resolve the target device (list the online devices and activate one) before retrying. If none is online, stop retrying. ${RECONNECT_HINT}`,
      };
    }

    case status === 401 || status === 403: {
      return {
        code: DeviceTransportErrorCode.Unauthorized,
        content: `The device gateway rejected this ${operation} as unauthorized (HTTP ${status}) — usually an edge security policy blocking the request, or a server configuration problem. Retrying the identical request will not fix it: replan with an equivalent approach, and report it to the user if there is none.`,
      };
    }

    case status === 429: {
      return {
        code: DeviceTransportErrorCode.RateLimited,
        content: `The device gateway is rate limiting this ${operation} (HTTP ${status}). Nothing ran on the device. Back off for a few seconds before retrying, and batch the remaining work into fewer calls.`,
      };
    }

    case status >= 500: {
      return {
        code: DeviceTransportErrorCode.GatewayError,
        content: `The device gateway failed while relaying this ${operation} (HTTP ${status}). This is an infrastructure error on the connection path, not a failure of the requested operation, and it is usually transient — retry once. If it persists, report it to the user rather than retrying in a loop.`,
      };
    }

    default: {
      return {
        code: DeviceTransportErrorCode.GatewayRejected,
        content: `The device gateway rejected this ${operation} (HTTP ${status}). The request never reached the device. Re-check the arguments before retrying; an identical retry will fail the same way.`,
      };
    }
  }
};

/**
 * Describe a non-ok gateway HTTP response.
 *
 * `body` is the gateway's response text; it is kept verbatim as `error` so that
 * existing matches on gateway codes (e.g. `DEVICE_OFFLINE`) keep working, and
 * appended to the explanation when it carries anything beyond the status.
 */
export const describeGatewayResponseFailure = (
  status: number,
  body: string | undefined,
  operation: DeviceTransportOperation,
): DeviceTransportFailure => {
  const { code, content } = describeStatus(status, operation);
  const detail = body?.trim();

  return {
    code,
    content: detail ? `${content}\n\nGateway detail: ${detail}` : content,
    error: detail || `${code} (HTTP ${status})`,
  };
};

const isTimeoutError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: string }).name;
  return name === 'TimeoutError' || name === 'AbortError';
};

const NETWORK_ERROR_MARKERS = [
  'fetch failed',
  'socket hang up',
  'connection refused',
  'connection reset',
  'econnrefused',
  'econnreset',
  'enotfound',
  'eai_again',
  'etimedout',
  'network',
];

const isNetworkError = (error: unknown, message: string): boolean => {
  const code = (error as { cause?: { code?: unknown }; code?: unknown } | null)?.code;
  const causeCode = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  const haystack = [message, code, causeCode]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  return NETWORK_ERROR_MARKERS.some((marker) => haystack.includes(marker));
};

/**
 * Describe a failure that happened before any HTTP status existed — the request
 * timed out client-side, or the gateway host could not be reached at all.
 *
 * A client-side timeout is the same situation as a 504 (the call may have been
 * delivered and may still be running), so it carries the same warning.
 */
export const describeGatewayRequestFailure = (
  error: unknown,
  operation: DeviceTransportOperation,
): DeviceTransportFailure => {
  const message = error instanceof Error ? error.message : String(error);

  if (isTimeoutError(error)) {
    return {
      code: DeviceTransportErrorCode.DeviceResponseTimeout,
      content: `This ${operation} timed out before the device answered. The work may still be running on the device, so do NOT blindly repeat anything that writes or has side effects — check the current state first and only retry if the change clearly did not happen.`,
      error: `${DeviceTransportErrorCode.DeviceResponseTimeout}: ${message}`,
    };
  }

  if (isNetworkError(error, message)) {
    return {
      code: DeviceTransportErrorCode.GatewayUnreachable,
      content: `Could not reach the device gateway to relay this ${operation}, so it never ran on the device. This is a network failure between the server and the gateway. Retry once; if it persists, report it to the user rather than retrying in a loop.`,
      error: `${DeviceTransportErrorCode.GatewayUnreachable}: ${message}`,
    };
  }

  // Cause unknown: say so rather than inventing one. The one thing we do know
  // is that the failure is on the device connection path, which decides how the
  // model should treat a retry.
  return {
    code: DeviceTransportErrorCode.GatewayError,
    content: `The device connection failed while relaying this ${operation}, so it is unclear whether the device ran it. Check the current state before repeating anything that writes or has side effects. Underlying error: ${message}`,
    error: `${DeviceTransportErrorCode.GatewayError}: ${message}`,
  };
};
