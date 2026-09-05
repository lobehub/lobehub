import { describe, expect, it } from 'vitest';

import {
  DeviceTransportErrorCode,
  describeGatewayRequestFailure,
  describeGatewayResponseFailure,
} from './deviceTransportError';

describe('describeGatewayResponseFailure', () => {
  it('separates "never delivered" (503) from "may still be running" (504)', () => {
    // This is the distinction the old `HTTP ${status}` string erased, and the
    // one that decides whether repeating a mutating call is safe.
    const undelivered = describeGatewayResponseFailure(503, '', 'tool call');
    const unanswered = describeGatewayResponseFailure(504, '', 'tool call');

    expect(undelivered.code).toBe(DeviceTransportErrorCode.DeviceChannelUnavailable);
    expect(undelivered.content).toContain('never ran on it');
    expect(undelivered.content).toContain('retrying the same call is safe');

    expect(unanswered.code).toBe(DeviceTransportErrorCode.DeviceResponseTimeout);
    expect(unanswered.content).toContain('may still be running');
    expect(unanswered.content).toContain('do NOT blindly repeat');
  });

  it('treats 502 like 503 — the gateway never handed the call over', () => {
    expect(describeGatewayResponseFailure(502, '', 'tool call').code).toBe(
      DeviceTransportErrorCode.DeviceChannelUnavailable,
    );
  });

  it('keeps the gateway body verbatim as the error so code matching still works', () => {
    // `directMentionExecutor` and the hetero dispatch headlines both match on
    // the raw gateway code.
    const failure = describeGatewayResponseFailure(503, 'DEVICE_OFFLINE', 'agent run');

    expect(failure.error).toBe('DEVICE_OFFLINE');
    expect(failure.content).toContain('Gateway detail: DEVICE_OFFLINE');
  });

  it('falls back to the mapped code when the gateway sent no body', () => {
    expect(describeGatewayResponseFailure(503, '', 'tool call').error).toBe(
      'DEVICE_CHANNEL_UNAVAILABLE (HTTP 503)',
    );
    expect(describeGatewayResponseFailure(500, undefined, 'RPC call').error).toBe(
      'DEVICE_GATEWAY_ERROR (HTTP 500)',
    );
  });

  it('marks auth failures as not worth retrying', () => {
    for (const status of [401, 403]) {
      const failure = describeGatewayResponseFailure(status, '', 'tool call');
      expect(failure.code).toBe(DeviceTransportErrorCode.Unauthorized);
      expect(failure.content).toContain('will not fix it');
    }
  });

  it('maps the remaining statuses to routing-aware codes', () => {
    expect(describeGatewayResponseFailure(404, '', 'tool call').code).toBe(
      DeviceTransportErrorCode.DeviceNotFound,
    );
    expect(describeGatewayResponseFailure(429, '', 'tool call').code).toBe(
      DeviceTransportErrorCode.RateLimited,
    );
    expect(describeGatewayResponseFailure(400, '', 'tool call').code).toBe(
      DeviceTransportErrorCode.GatewayRejected,
    );
  });

  it('names the operation that failed', () => {
    expect(describeGatewayResponseFailure(503, '', 'message API call').content).toContain(
      'message API call',
    );
    expect(describeGatewayResponseFailure(503, '', 'agent run').content).toContain('agent run');
  });

  it('carries the retry policy that used to live in the system prompt', () => {
    // The prompt block naming these budgets was deleted: guidance belongs on
    // the failure it applies to, not in a static preamble paid for on every
    // call that also silently rots when the wire copy changes.
    const undelivered = describeGatewayResponseFailure(503, '', 'tool call');
    expect(undelivered.content).toContain('retry up to 8 times');
    expect(undelivered.content).toContain('stop retrying it and replan');

    const unanswered = describeGatewayResponseFailure(504, '', 'tool call');
    expect(unanswered.content).toContain('safe to repeat');

    const blocked = describeGatewayResponseFailure(403, '', 'tool call');
    expect(blocked.content).toContain('edge security policy');
    expect(blocked.content).toContain('replan with an equivalent approach');
  });

  it('always keeps the status in the sentence for log correlation', () => {
    // Not showing the code *bare* is the point; dropping it entirely would cost
    // operators the only thing that correlates with gateway logs.
    for (const status of [400, 401, 404, 429, 500, 503, 504]) {
      expect(describeGatewayResponseFailure(status, '', 'tool call').content).toContain(
        `HTTP ${status}`,
      );
    }
  });
});

describe('describeGatewayRequestFailure', () => {
  it('treats a client-side abort like a 504 — the call may have landed', () => {
    const failure = describeGatewayRequestFailure(
      Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      }),
      'tool call',
    );

    expect(failure.code).toBe(DeviceTransportErrorCode.DeviceResponseTimeout);
    expect(failure.content).toContain('do NOT blindly repeat');
    expect(failure.error).toContain('The operation was aborted due to timeout');
  });

  it('recognises the DOM AbortError name as well', () => {
    expect(
      describeGatewayRequestFailure(Object.assign(new Error('aborted'), { name: 'AbortError' }), 'tool call')
        .code,
    ).toBe(DeviceTransportErrorCode.DeviceResponseTimeout);
  });

  it('reports a dead gateway host as an undelivered call', () => {
    const failure = describeGatewayRequestFailure(new TypeError('fetch failed'), 'tool call');

    expect(failure.code).toBe(DeviceTransportErrorCode.GatewayUnreachable);
    expect(failure.content).toContain('never ran on the device');
    expect(failure.error).toContain('fetch failed');
  });

  it('recognises a plain-English connection failure', () => {
    // Node's own driver messages ("connection refused") carry no `E*` code, so
    // matching on codes alone dropped the most common device-gateway failure
    // into the unknown bucket.
    expect(describeGatewayRequestFailure(new Error('connection refused'), 'tool call').code).toBe(
      DeviceTransportErrorCode.GatewayUnreachable,
    );
  });

  it('recognises a network failure carried on `cause.code`', () => {
    const failure = describeGatewayRequestFailure(
      Object.assign(new Error('request to gateway failed'), { cause: { code: 'ECONNREFUSED' } }),
      'tool call',
    );

    expect(failure.code).toBe(DeviceTransportErrorCode.GatewayUnreachable);
  });

  it('does not invent a cause for an unrecognised failure', () => {
    // The old copy claimed the gateway was unreachable for every rejection,
    // including ones (a malformed response body, say) that prove nothing about
    // whether the device ran the call.
    const failure = describeGatewayRequestFailure(new Error('Unexpected token < in JSON'), 'tool call');

    expect(failure.code).toBe(DeviceTransportErrorCode.GatewayError);
    expect(failure.content).toContain('unclear whether the device ran it');
    expect(failure.content).toContain('Unexpected token < in JSON');
  });

  it('handles a non-Error rejection', () => {
    expect(describeGatewayRequestFailure('boom', 'tool call').error).toContain('boom');
  });
});
