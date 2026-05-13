// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { GET } from '@/app/(backend)/api/version/route';
import apiApp from '@/server/api-hono';
import honoApp from '@/server/hono';

import pkg from '../../../package.json';

const expectVersionResponse = async (response: Response) => {
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ version: pkg.version });
};

describe('/api/version runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await GET(new Request('https://example.com/api/version'));

    expect(response.headers.get('x-lobe-api-runtime')).toBe('next');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectVersionResponse(response);
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await GET(
      new Request('https://example.com/api/version', {
        headers: { 'x-lobe-api-runtime': 'hono' },
      }),
    );

    expect(response.headers.get('x-lobe-api-runtime')).toBe('hono');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectVersionResponse(response);
  });

  it('can be served by the standalone API Hono app', async () => {
    const response = await apiApp.fetch(new Request('https://example.com/api/version'));

    await expectVersionResponse(response);
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(new Request('https://example.com/api/version'));

    await expectVersionResponse(response);
  });
});
