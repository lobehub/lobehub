import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parseRealtimeAsrServerEvent,
  parseRealtimeAsrSessionResponse,
  REALTIME_ASR_AUDIO,
  REALTIME_ASR_LIMITS,
} from './contract';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const TEST_JWT = [
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiJ1c2VyLTEifQ',
  'c2lnbmF0dXJl',
].join('.');

const sessionResponse = (token: string) => ({
  audio: REALTIME_ASR_AUDIO,
  expiresAt: '2026-08-21T12:00:30.000Z',
  limits: REALTIME_ASR_LIMITS,
  protocolVersion: 1,
  sessionId: SESSION_ID,
  token,
  websocketUrl: `wss://asr.example.test/api/v1/realtime/ws?sessionId=${SESSION_ID}`,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('parseRealtimeAsrSessionResponse', () => {
  it('accepts the frozen v1 response with a three-segment JWT', () => {
    const response = sessionResponse(TEST_JWT);

    expect(parseRealtimeAsrSessionResponse(response)).toEqual(response);
  });

  it('accepts a JWT at the 4096-character boundary', () => {
    const token = `aa.bb.${'c'.repeat(4090)}`;

    expect(parseRealtimeAsrSessionResponse(sessionResponse(token)).token).toBe(token);
  });

  it('allows insecure WebSockets only for loopback development gateways', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(
      parseRealtimeAsrSessionResponse({
        ...sessionResponse(TEST_JWT),
        websocketUrl: `ws://127.0.0.1:8787/api/v1/realtime/ws?sessionId=${SESSION_ID}`,
      }).websocketUrl,
    ).toBe(`ws://127.0.0.1:8787/api/v1/realtime/ws?sessionId=${SESSION_ID}`);
    expect(() =>
      parseRealtimeAsrSessionResponse({
        ...sessionResponse(TEST_JWT),
        websocketUrl: `ws://asr.example.test/api/v1/realtime/ws?sessionId=${SESSION_ID}`,
      }),
    ).toThrowError(expect.objectContaining({ code: 'PROTOCOL_ERROR' }));
  });

  it('rejects insecure loopback WebSockets outside development', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(() =>
      parseRealtimeAsrSessionResponse({
        ...sessionResponse(TEST_JWT),
        websocketUrl: `ws://localhost:8787/api/v1/realtime/ws?sessionId=${SESSION_ID}`,
      }),
    ).toThrowError(expect.objectContaining({ code: 'PROTOCOL_ERROR' }));
  });

  it.each([
    ['an opaque id', 'session-1'],
    ['an uppercase UUID', 'a0000000-b000-4c00-8d00-e00000000001'.toUpperCase()],
    ['a non-v4 UUID', '00000000-0000-1000-8000-000000000001'],
    ['a UUID without an RFC4122 variant', '00000000-0000-4000-7000-000000000001'],
  ])('rejects %s as the session id in responses and events', (_case, sessionId) => {
    expect(() =>
      parseRealtimeAsrSessionResponse({ ...sessionResponse(TEST_JWT), sessionId }),
    ).toThrowError(expect.objectContaining({ code: 'PROTOCOL_ERROR' }));
    expect(() =>
      parseRealtimeAsrServerEvent({
        audio: REALTIME_ASR_AUDIO,
        limits: REALTIME_ASR_LIMITS,
        protocolVersion: 1,
        sequence: 1,
        sessionId,
        type: 'session.ready',
      }),
    ).toThrowError(expect.objectContaining({ code: 'PROTOCOL_ERROR' }));
  });

  it.each([
    ['the legacy opaque token', 'a'.repeat(43)],
    ['an empty header', `.payload.signature`],
    ['an empty payload', `header..signature`],
    ['an empty signature', `header.payload.`],
    ['two segments', `header.payload`],
    ['four segments', `header.payload.signature.extra`],
    ['non-base64url characters', `header.pay+load.signature`],
    ['base64 padding', `header.payload.signature=`],
    ['a token longer than 4096 characters', `aa.bb.${'c'.repeat(4091)}`],
  ])('rejects %s', (_case, token) => {
    expect(() => parseRealtimeAsrSessionResponse(sessionResponse(token))).toThrowError(
      expect.objectContaining({ code: 'PROTOCOL_ERROR', retryable: false }),
    );
  });

  it.each([
    [
      'a token in the query',
      `wss://asr.example.test/api/v1/realtime/ws?sessionId=${SESSION_ID}&token=credential`,
    ],
    [
      'a mismatched session id',
      'wss://asr.example.test/api/v1/realtime/ws?sessionId=00000000-0000-4000-8000-000000000002',
    ],
    ['the wrong path', `wss://asr.example.test/realtime/ws?sessionId=${SESSION_ID}`],
    [
      'an extra query parameter',
      `wss://asr.example.test/api/v1/realtime/ws?sessionId=${SESSION_ID}&debug=1`,
    ],
    [
      'a duplicate session id parameter',
      `wss://asr.example.test/api/v1/realtime/ws?sessionId=${SESSION_ID}&sessionId=${SESSION_ID}`,
    ],
    [
      'URL credentials',
      `wss://user:password@asr.example.test/api/v1/realtime/ws?sessionId=${SESSION_ID}`,
    ],
    [
      'a URL fragment',
      `wss://asr.example.test/api/v1/realtime/ws?sessionId=${SESSION_ID}#fragment`,
    ],
  ])('rejects a websocket URL with %s', (_case, websocketUrl) => {
    expect(() =>
      parseRealtimeAsrSessionResponse({ ...sessionResponse(TEST_JWT), websocketUrl }),
    ).toThrowError(expect.objectContaining({ code: 'PROTOCOL_ERROR' }));
  });

  it('rejects extra top-level response keys', () => {
    expect(() =>
      parseRealtimeAsrSessionResponse({ ...sessionResponse(TEST_JWT), provider: 'upstream' }),
    ).toThrowError(expect.objectContaining({ code: 'PROTOCOL_ERROR' }));
  });

  it('rejects extra keys in frozen audio and limits objects', () => {
    const response = sessionResponse(TEST_JWT);

    expect(() =>
      parseRealtimeAsrSessionResponse({
        ...response,
        audio: { ...response.audio, providerSampleRate: 16_000 },
      }),
    ).toThrowError(expect.objectContaining({ code: 'PROTOCOL_ERROR' }));
    expect(() =>
      parseRealtimeAsrSessionResponse({
        ...response,
        limits: { ...response.limits, providerTimeoutMs: 10_000 },
      }),
    ).toThrowError(expect.objectContaining({ code: 'PROTOCOL_ERROR' }));
  });
});

describe('parseRealtimeAsrServerEvent', () => {
  const terminalEvent = {
    sequence: 1,
    sessionId: SESSION_ID,
    type: 'session.completed' as const,
  };

  it('accepts integral forwarded audio through the maximum session duration', () => {
    expect(
      parseRealtimeAsrServerEvent({
        ...terminalEvent,
        forwardedAudioMs: REALTIME_ASR_LIMITS.maxSessionMs,
      }),
    ).toMatchObject({ forwardedAudioMs: REALTIME_ASR_LIMITS.maxSessionMs });
  });

  it.each([-1, 0.5, REALTIME_ASR_LIMITS.maxSessionMs + 1, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid forwarded audio duration %s',
    (forwardedAudioMs) => {
      expect(() =>
        parseRealtimeAsrServerEvent({ ...terminalEvent, forwardedAudioMs }),
      ).toThrowError(expect.objectContaining({ code: 'PROTOCOL_ERROR' }));
    },
  );
});
