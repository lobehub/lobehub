// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { POST as casdoorPost } from '@/app/(backend)/api/webhooks/casdoor/route';
import { POST as logtoPost } from '@/app/(backend)/api/webhooks/logto/route';
import { POST as videoWebhookPost } from '@/app/(backend)/api/webhooks/video/[provider]/route';
import apiApp from '@/server/api-hono';
import honoApp from '@/server/hono';

const createCasdoorRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/api/webhooks/casdoor', {
    body: JSON.stringify({ action: 'update-user', object: { displayName: 'Test', id: 'uid' } }),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    method: 'POST',
  });

const expectVerificationFailure = async (response: Response) => {
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: 'webhook verification failed or payload was malformed',
  });
};

const createLogtoRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/api/webhooks/logto', {
    body: JSON.stringify({
      data: { id: 'uid', isSuspended: false },
      event: 'User.SuspensionStatus.Updated',
    }),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    method: 'POST',
  });

const createInvalidVideoWebhookRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/api/webhooks/video/openai', {
    body: '{',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    method: 'POST',
  });

const createVideoWebhookSegmentData = () => ({ params: Promise.resolve({ provider: 'openai' }) });

const expectInvalidVideoWebhookBody = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(400);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.json()).toEqual({ error: 'Invalid JSON body' });
};

describe('/api/webhooks/casdoor runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await casdoorPost(createCasdoorRequest());

    expect(response.headers.get('x-lobe-api-runtime')).toBe('next');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectVerificationFailure(response);
  });

  it('returns the same verification response through the Hono gray-release path', async () => {
    const response = await casdoorPost(createCasdoorRequest({ 'x-lobe-api-runtime': 'hono' }));

    expect(response.headers.get('x-lobe-api-runtime')).toBe('hono');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectVerificationFailure(response);
  });

  it('can be served by the standalone API Hono app', async () => {
    const response = await apiApp.fetch(createCasdoorRequest());

    await expectVerificationFailure(response);
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createCasdoorRequest());

    await expectVerificationFailure(response);
  });
});

describe('/api/webhooks/video/:provider runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await videoWebhookPost(
      createInvalidVideoWebhookRequest(),
      createVideoWebhookSegmentData(),
    );

    expect(response.headers.get('x-lobe-api-runtime')).toBe('next');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectInvalidVideoWebhookBody(response, 'next');
  });

  it('returns the same invalid body response through the Hono gray-release path', async () => {
    const response = await videoWebhookPost(
      createInvalidVideoWebhookRequest({ 'x-lobe-api-runtime': 'hono' }),
      createVideoWebhookSegmentData(),
    );

    expect(response.headers.get('x-lobe-api-runtime')).toBe('hono');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectInvalidVideoWebhookBody(response, 'hono');
  });

  it('can be served by the standalone API Hono app', async () => {
    const response = await apiApp.fetch(createInvalidVideoWebhookRequest());

    await expectInvalidVideoWebhookBody(response);
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createInvalidVideoWebhookRequest());

    await expectInvalidVideoWebhookBody(response);
  });
});

describe('/api/webhooks/logto runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await logtoPost(createLogtoRequest());

    expect(response.headers.get('x-lobe-api-runtime')).toBe('next');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectVerificationFailure(response);
  });

  it('returns the same verification response through the Hono gray-release path', async () => {
    const response = await logtoPost(createLogtoRequest({ 'x-lobe-api-runtime': 'hono' }));

    expect(response.headers.get('x-lobe-api-runtime')).toBe('hono');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectVerificationFailure(response);
  });

  it('can be served by the standalone API Hono app', async () => {
    const response = await apiApp.fetch(createLogtoRequest());

    await expectVerificationFailure(response);
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createLogtoRequest());

    await expectVerificationFailure(response);
  });
});
