import { afterEach, describe, expect, it } from 'vitest';

import { selectAPIRuntime, withAPIRuntimeHeaders } from './runtime';

const ENV_KEYS = [
  'LOBE_API_RUNTIME',
  'LOBE_API_HONO_PERCENT',
  'LOBE_API_AUTH_CHECK_USER_RUNTIME',
  'LOBE_API_AUTH_CHECK_USER_HONO_PERCENT',
  'LOBE_API_AUTH_RESOLVE_USERNAME_RUNTIME',
  'LOBE_API_AUTH_RESOLVE_USERNAME_HONO_PERCENT',
  'LOBE_API_V1_RUNTIME',
  'LOBE_API_V1_HONO_PERCENT',
  'LOBE_API_VERSION_RUNTIME',
  'LOBE_API_VERSION_HONO_PERCENT',
  'LOBE_API_WEBHOOKS_CASDOOR_RUNTIME',
  'LOBE_API_WEBHOOKS_CASDOOR_HONO_PERCENT',
  'LOBE_API_WEBHOOKS_LOGTO_RUNTIME',
  'LOBE_API_WEBHOOKS_LOGTO_HONO_PERCENT',
  'LOBE_FILE_PROXY_RUNTIME',
  'LOBE_FILE_PROXY_HONO_PERCENT',
  'LOBE_WEBAPI_CHAT_RUNTIME',
  'LOBE_WEBAPI_CHAT_HONO_PERCENT',
  'LOBE_WEBAPI_MODELS_RUNTIME',
  'LOBE_WEBAPI_MODELS_HONO_PERCENT',
  'LOBE_WEBAPI_MODELS_PULL_RUNTIME',
  'LOBE_WEBAPI_MODELS_PULL_HONO_PERCENT',
  'LOBE_WEBAPI_STT_OPENAI_RUNTIME',
  'LOBE_WEBAPI_STT_OPENAI_HONO_PERCENT',
  'LOBE_WEBAPI_TTS_EDGE_RUNTIME',
  'LOBE_WEBAPI_TTS_EDGE_HONO_PERCENT',
  'LOBE_WEBAPI_TTS_MICROSOFT_RUNTIME',
  'LOBE_WEBAPI_TTS_MICROSOFT_HONO_PERCENT',
  'LOBE_WEBAPI_TTS_OPENAI_RUNTIME',
  'LOBE_WEBAPI_TTS_OPENAI_HONO_PERCENT',
  'LOBE_WEBAPI_USER_AVATAR_RUNTIME',
  'LOBE_WEBAPI_USER_AVATAR_HONO_PERCENT',
] as const;

const originalEnv = { ...process.env };

const createRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/api/version', { headers });

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
});

describe('selectAPIRuntime', () => {
  it('uses the Next.js route by default', () => {
    const selection = selectAPIRuntime(createRequest(), 'api-version');

    expect(selection).toEqual({
      percent: 0,
      reason: 'default',
      runtime: 'next',
    });
  });

  it('allows request header override for Hono', () => {
    const selection = selectAPIRuntime(
      createRequest({ 'x-lobe-api-runtime': 'hono' }),
      'api-version',
    );

    expect(selection).toEqual({
      percent: 100,
      reason: 'request-header',
      runtime: 'hono',
    });
  });

  it('keeps route-scoped env higher priority than the global env', () => {
    process.env.LOBE_API_VERSION_RUNTIME = 'next';
    process.env.LOBE_API_RUNTIME = 'hono';

    const selection = selectAPIRuntime(createRequest(), 'api-version');

    expect(selection.runtime).toBe('next');
    expect(selection.reason).toBe('LOBE_API_VERSION_RUNTIME/LOBE_API_RUNTIME');
  });

  it('supports the OpenAPI route id', () => {
    process.env.LOBE_API_V1_RUNTIME = 'hono';

    const selection = selectAPIRuntime(new Request('https://example.com/api/v1/health'), 'api-v1');

    expect(selection).toEqual({
      percent: 100,
      reason: 'LOBE_API_V1_RUNTIME/LOBE_API_RUNTIME',
      runtime: 'hono',
    });
  });

  it('allows percent-only gray rollout', () => {
    process.env.LOBE_API_HONO_PERCENT = '100';

    const selection = selectAPIRuntime(createRequest(), 'api-version');

    expect(selection).toEqual({
      percent: 100,
      reason: 'gray-percent-env',
      runtime: 'hono',
    });
  });

  it('supports route-scoped auth lookup rollout', () => {
    process.env.LOBE_API_AUTH_CHECK_USER_HONO_PERCENT = '100';

    const selection = selectAPIRuntime(
      new Request('https://example.com/api/auth/check-user'),
      'api-auth-check-user',
    );

    expect(selection).toEqual({
      percent: 100,
      reason: 'gray-percent-env',
      runtime: 'hono',
    });
  });

  it('supports route-scoped webhook rollout', () => {
    process.env.LOBE_API_WEBHOOKS_CASDOOR_RUNTIME = 'hono';

    const selection = selectAPIRuntime(
      new Request('https://example.com/api/webhooks/casdoor'),
      'api-webhooks-casdoor',
    );

    expect(selection).toEqual({
      percent: 100,
      reason: 'LOBE_API_WEBHOOKS_CASDOOR_RUNTIME/LOBE_API_RUNTIME',
      runtime: 'hono',
    });
  });
});

describe('withAPIRuntimeHeaders', () => {
  it('adds runtime observability headers without changing response body or status', async () => {
    const response = withAPIRuntimeHeaders(
      new Response('ok', {
        headers: { 'content-type': 'text/plain' },
        status: 201,
      }),
      {
        percent: 100,
        reason: 'request-header',
        runtime: 'hono',
      },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('text/plain');
    expect(response.headers.get('x-lobe-api-runtime')).toBe('hono');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    expect(await response.text()).toBe('ok');
  });
});
