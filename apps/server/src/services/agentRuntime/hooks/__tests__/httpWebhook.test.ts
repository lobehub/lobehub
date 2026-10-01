import { inspect } from 'node:util';

import { QstashError } from '@upstash/qstash';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deliverWebhook, executeToolCallWebhook, resolveWebhookHeaders } from '../httpWebhook';

const { fetchMock, publish } = vi.hoisted(() => ({ fetchMock: vi.fn(), publish: vi.fn() }));
vi.mock('@/libs/qstash', () => ({
  OtelQstashClient: class {
    publishJSON = publish;
  },
}));
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const config = { responseHandling: 'toolCall' as const, url: 'https://example.com/hooks' };

describe('HTTP hook primitive', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    publish.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('uses fetch without redirects and with a default deadline', async () => {
    fetchMock.mockResolvedValue(new Response('{"decision":"allow"}'));
    expect(await executeToolCallWebhook(config, { args: { value: 1 } })).toMatchObject({
      status: 'success',
    });
    const [, request] = fetchMock.mock.calls[0];
    expect(request).toMatchObject({
      method: 'POST',
      redirect: 'error',
      body: '{"args":{"value":1}}',
    });
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([200, 204, 205])('rejects empty control response %i', async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    expect(await executeToolCallWebhook(config, {})).toEqual({
      status: 'error',
      code: 'invalid_response',
    });
  });
  it.each([201, 202, 206])(
    'requires HTTP 200 even with a valid control body: %i',
    async (status) => {
      fetchMock.mockResolvedValue(new Response('{"decision":"allow"}', { status }));
      expect(await executeToolCallWebhook(config, {})).toEqual({
        status: 'error',
        code: 'invalid_response',
      });
    },
  );
  it.each([200, 204, 205])('accepts empty notification response %i', async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    await expect(deliverWebhook({ url: config.url }, {})).resolves.toBeUndefined();
  });
  it.each([301, 400, 500])('rejects status %i without parsing the body', async (status) => {
    fetchMock.mockResolvedValue(new Response('{"decision":"allow"}', { status }));
    expect(await executeToolCallWebhook(config, {})).toEqual({
      status: 'error',
      code: 'http_error',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('returns sanitized errors and never retries', async () => {
    fetchMock.mockRejectedValue(new Error('secret remote response'));
    expect(await executeToolCallWebhook(config, {})).toEqual({
      status: 'error',
      code: 'network_error',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('rejects oversize before parsing, including whitespace', async () => {
    fetchMock.mockResolvedValue(new Response('{}' + ' '.repeat(65_535)));
    expect(await executeToolCallWebhook(config, {})).toEqual({
      status: 'error',
      code: 'response_too_large',
    });
  });
  it('times out while waiting and distinguishes cancellation', async () => {
    fetchMock.mockImplementation(
      (_url, { signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        ),
    );
    expect(await executeToolCallWebhook({ ...config, timeout: 0.01 }, {})).toEqual({
      status: 'error',
      code: 'timeout',
    });
    const controller = new AbortController();
    const pending = executeToolCallWebhook(config, {}, { signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual({ status: 'cancelled' });
    expect(await executeToolCallWebhook(config, {}, { signal: controller.signal })).toEqual({
      status: 'cancelled',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('discards a late allow after cancellation even if transport ignores abort', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => {
      controller.abort();
      return new Response('{"decision":"allow"}');
    });
    expect(await executeToolCallWebhook(config, {}, { signal: controller.signal })).toEqual({
      status: 'cancelled',
    });
  });
  it('refuses controls in the notification path and invalid control config before sending', async () => {
    await expect(deliverWebhook(config, {})).rejects.toThrow('configuration');
    expect(await executeToolCallWebhook({ ...config, eventFields: [] }, {})).toEqual({
      status: 'error',
      code: 'configuration',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('ignores legacy notification response bodies', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not json'));
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([0xff])));
    fetchMock.mockResolvedValueOnce(new Response('{"decision":"deny","reason":"ignored"}'));
    await expect(
      deliverWebhook({ url: config.url, fallback: 'none' }, {}),
    ).resolves.toBeUndefined();
    await expect(deliverWebhook({ url: config.url }, {})).resolves.toBeUndefined();
    await expect(deliverWebhook({ url: config.url }, {})).resolves.toBeUndefined();
  });
  it('expands only allowed env values at send time without mutating configuration', async () => {
    vi.stubEnv('HOOK_TOKEN', 'first-secret');
    const webhook = {
      ...config,
      allowedEnvVars: ['HOOK_TOKEN'],
      headers: { 'Authorization': 'Bearer ${HOOK_TOKEN}', 'X-Static': 'value' },
    };
    expect(resolveWebhookHeaders(webhook).authorization).toBe('Bearer first-secret');
    vi.stubEnv('HOOK_TOKEN', 'rotated-secret');
    expect(resolveWebhookHeaders(webhook).authorization).toBe('Bearer rotated-secret');
    expect(webhook.headers.Authorization).toBe('Bearer ${HOOK_TOKEN}');
    expect(() => resolveWebhookHeaders({ ...webhook, allowedEnvVars: [] })).toThrow(
      'configuration',
    );
    vi.stubEnv('HOOK_TOKEN', undefined);
    expect(() => resolveWebhookHeaders(webhook)).toThrow('configuration');
  });
  it.each<Record<string, string>>([
    { Host: 'internal' },
    { 'Content-Length': '1' },
    { 'Upstash-Callback': 'evil' },
    { 'X-Key': '${NOPE}' },
    { 'X-Key': 'bad\r\nsecret' },
    { 'X-Key': '${broken' },
  ])('rejects unsafe headers %#', (headers) => {
    expect(() => resolveWebhookHeaders({ ...config, headers })).toThrow('configuration');
  });
  it('forwards templates and timeout to QStash; fallback:none never sends unsigned fetch', async () => {
    vi.stubEnv('QSTASH_TOKEN', 'test-token');
    vi.stubEnv('HOOK_TOKEN', 'secret');
    const webhook = {
      url: config.url,
      delivery: 'qstash' as const,
      timeout: 4,
      fallback: 'none' as const,
      headers: { Authorization: 'Bearer ${HOOK_TOKEN}' },
      allowedEnvVars: ['HOOK_TOKEN'],
    };
    await deliverWebhook(webhook, { value: 1 });
    expect(publish.mock.calls[0][0]).toMatchObject({
      headers: { authorization: 'Bearer secret' },
      timeout: 4,
    });
    publish.mockRejectedValue(new Error('remote secret'));
    await expect(deliverWebhook(webhook, {})).rejects.toThrow('network_error');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('missing QStash token falls back once, never retries a failed fetch', async () => {
    vi.stubEnv('QSTASH_TOKEN', undefined);
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(deliverWebhook({ url: config.url, delivery: 'qstash' }, {})).rejects.toThrow(
      'network_error',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });
  it('preserves the missing-token configuration diagnosis without unsigned fallback', async () => {
    vi.stubEnv('QSTASH_TOKEN', undefined);
    await expect(
      deliverWebhook({ url: config.url, delivery: 'qstash', fallback: 'none' }, {}),
    ).rejects.toMatchObject({
      code: 'configuration',
      message: expect.stringContaining('QSTASH_TOKEN not available'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([401, 429, 503])(
    'preserves QStash HTTP %i without exposing SDK response data',
    async (status) => {
      vi.stubEnv('QSTASH_TOKEN', 'private-token');
      const sdkError = new QstashError('private-response private-token private-header', status);
      Object.assign(sdkError, { headers: { Authorization: 'private-header' } });
      publish.mockRejectedValue(sdkError);
      const error = await deliverWebhook(
        { url: config.url, delivery: 'qstash', fallback: 'none' },
        {},
      ).catch((error: unknown) => error);
      expect(error).toMatchObject({
        code: 'http_error',
        status,
        message: expect.stringContaining(`QStash publish failed (HTTP ${status})`),
      });
      expect(inspect(error)).not.toMatch(/private-response|private-token|private-header/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('logs the QStash failure even when fetch fallback succeeds', async () => {
    vi.stubEnv('QSTASH_TOKEN', 'private-token');
    publish.mockRejectedValue(new QstashError('private-response', 503));
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      deliverWebhook({ url: config.url, delivery: 'qstash' }, {}),
    ).resolves.toBeUndefined();
    expect(logger).toHaveBeenCalledWith(
      '[HookDispatcher] QStash delivery failed, falling back to fetch',
      expect.objectContaining({ code: 'http_error', status: 503 }),
    );
    expect(inspect(logger.mock.calls)).not.toContain('private-response');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('credential and response boundaries', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it('adds automatic deployment bypass only for the configured application origin', async () => {
    publish.mockReset().mockResolvedValue({ messageId: 'test' });
    vi.stubEnv('QSTASH_TOKEN', 'test-token');
    vi.stubEnv('APP_URL', 'https://app.example.com');
    vi.stubEnv('INTERNAL_APP_URL', undefined);
    vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', 'private-bypass');
    await deliverWebhook({ delivery: 'qstash', url: 'https://external.example.com/hook' }, {});
    expect(publish.mock.calls[0][0].headers).not.toHaveProperty('x-vercel-protection-bypass');
    await deliverWebhook({ delivery: 'qstash', url: '/hook' }, {});
    expect(publish.mock.calls[1][0].headers['x-vercel-protection-bypass']).toBe('private-bypass');
  });
  it('reports invalid UTF-8 as a protocol error', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([0xc3, 0x28])));
    expect(await executeToolCallWebhook(config, {})).toEqual({
      code: 'invalid_response',
      status: 'error',
    });
  });
});
