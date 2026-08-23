import { beforeEach, describe, expect, it, vi } from 'vitest';

import { REALTIME_ASR_AUDIO, REALTIME_ASR_LIMITS } from './contract';
import { createRealtimeAsrSession } from './service';

vi.mock('@/business/client/trpc-headers', () => ({
  getBusinessTrpcHeaders: vi.fn().mockResolvedValue({ 'X-Test-Scope': 'scope-1' }),
}));

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const TEST_JWT = [
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiJ1c2VyLTEifQ',
  'c2lnbmF0dXJl',
].join('.');

const responseBody = {
  audio: REALTIME_ASR_AUDIO,
  expiresAt: '2026-08-10T04:00:00.000Z',
  limits: REALTIME_ASR_LIMITS,
  protocolVersion: 1,
  sessionId: SESSION_ID,
  token: TEST_JWT,
  websocketUrl: `wss://asr.example.test/api/v1/realtime/ws?sessionId=${SESSION_ID}`,
};

describe('createRealtimeAsrSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the provider-neutral Lobe Session API and validates its frozen contract', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );
    const controller = new AbortController();

    await expect(createRealtimeAsrSession(controller.signal, fetcher)).resolves.toEqual(
      responseBody,
    );
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('/api/asr/realtime/session');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ platform: 'web' });
    expect(init.headers.get('X-Test-Scope')).toBe('scope-1');
  });

  it('rejects a session with a non-secure WebSocket URL', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ...responseBody, websocketUrl: 'ws://provider.example.test' }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        },
      ),
    );

    await expect(
      createRealtimeAsrSession(new AbortController().signal, fetcher),
    ).rejects.toMatchObject({ code: 'PROTOCOL_ERROR', retryable: false });
  });

  it('reports a malformed Admission token as a non-retryable protocol error', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...responseBody, token: 'a'.repeat(43) }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );

    await expect(
      createRealtimeAsrSession(new AbortController().signal, fetcher),
    ).rejects.toMatchObject({ code: 'PROTOCOL_ERROR', retryable: false });
  });

  it.each([
    [400, 'SESSION_CREATE_FAILED', false],
    [401, 'AUTH_FAILED', false],
    [402, 'PROVIDER_BILLING_BLOCKED', false],
    [403, 'AUTH_FAILED', false],
    [404, 'PROVIDER_NOT_CONFIGURED', false],
    [429, 'SESSION_LIMIT_EXCEEDED', true],
    [503, 'PROVIDER_UNAVAILABLE', true],
  ])('maps HTTP %i to stable error %s', async (status, code, retryable) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));

    await expect(
      createRealtimeAsrSession(new AbortController().signal, fetcher),
    ).rejects.toMatchObject({ code, retryable });
  });
});
