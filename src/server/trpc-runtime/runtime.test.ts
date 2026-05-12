import { afterEach, describe, expect, it } from 'vitest';

import { selectTRPCRuntime, withTRPCRuntimeHeaders } from './runtime';

const ENV_KEYS = [
  'LOBE_TRPC_RUNTIME',
  'LOBE_TRPC_HONO_PERCENT',
  'LOBE_TRPC_ASYNC_RUNTIME',
  'LOBE_TRPC_ASYNC_HONO_PERCENT',
  'LOBE_TRPC_LAMBDA_RUNTIME',
  'LOBE_TRPC_LAMBDA_HONO_PERCENT',
  'LOBE_TRPC_MOBILE_RUNTIME',
  'LOBE_TRPC_MOBILE_HONO_PERCENT',
  'LOBE_TRPC_TOOLS_RUNTIME',
  'LOBE_TRPC_TOOLS_HONO_PERCENT',
] as const;

const originalEnv = { ...process.env };

const createRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/trpc/lambda/config.getGlobalConfig', { headers });

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
});

describe('selectTRPCRuntime', () => {
  it('uses the Next.js route by default', () => {
    const selection = selectTRPCRuntime(createRequest(), 'lambda');

    expect(selection).toEqual({
      percent: 0,
      reason: 'default',
      runtime: 'next',
    });
  });

  it('allows request header override for Hono', () => {
    const selection = selectTRPCRuntime(createRequest({ 'x-lobe-trpc-runtime': 'hono' }), 'lambda');

    expect(selection).toEqual({
      percent: 100,
      reason: 'request-header',
      runtime: 'hono',
    });
  });

  it('allows route-scoped env override for Hono', () => {
    process.env.LOBE_TRPC_LAMBDA_RUNTIME = 'hono';

    const selection = selectTRPCRuntime(createRequest(), 'lambda');

    expect(selection).toEqual({
      percent: 100,
      reason: 'LOBE_TRPC_LAMBDA_RUNTIME/LOBE_TRPC_RUNTIME',
      runtime: 'hono',
    });
  });

  it('keeps route-scoped env higher priority than the global env', () => {
    process.env.LOBE_TRPC_LAMBDA_RUNTIME = 'next';
    process.env.LOBE_TRPC_RUNTIME = 'hono';

    const selection = selectTRPCRuntime(createRequest(), 'lambda');

    expect(selection.runtime).toBe('next');
    expect(selection.reason).toBe('LOBE_TRPC_LAMBDA_RUNTIME/LOBE_TRPC_RUNTIME');
  });

  it('uses Hono when gray percent is 100', () => {
    process.env.LOBE_TRPC_RUNTIME = 'gray';
    process.env.LOBE_TRPC_HONO_PERCENT = '100';

    const selection = selectTRPCRuntime(createRequest(), 'lambda');

    expect(selection).toEqual({
      percent: 100,
      reason: 'gray-runtime-env',
      runtime: 'hono',
    });
  });

  it('uses Next.js when gray percent is 0', () => {
    process.env.LOBE_TRPC_RUNTIME = 'gray';
    process.env.LOBE_TRPC_HONO_PERCENT = '0';

    const selection = selectTRPCRuntime(createRequest(), 'lambda');

    expect(selection).toEqual({
      percent: 0,
      reason: 'gray-runtime-env',
      runtime: 'next',
    });
  });

  it('allows percent-only gray rollout without changing runtime mode', () => {
    process.env.LOBE_TRPC_HONO_PERCENT = '100';

    const selection = selectTRPCRuntime(createRequest(), 'lambda');

    expect(selection).toEqual({
      percent: 100,
      reason: 'gray-percent-env',
      runtime: 'hono',
    });
  });

  it('ignores invalid runtime values and falls back to default', () => {
    process.env.LOBE_TRPC_RUNTIME = 'invalid';

    const selection = selectTRPCRuntime(createRequest(), 'lambda');

    expect(selection.runtime).toBe('next');
    expect(selection.reason).toBe('default');
  });
});

describe('withTRPCRuntimeHeaders', () => {
  it('adds runtime observability headers without changing response body or status', async () => {
    const response = withTRPCRuntimeHeaders(
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
    expect(response.headers.get('x-lobe-trpc-runtime')).toBe('hono');
    expect(response.headers.get('x-lobe-trpc-runtime-reason')).toBe('request-header');
    expect(await response.text()).toBe('ok');
  });
});
