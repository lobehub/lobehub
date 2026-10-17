import { afterEach, describe, expect, it, vi } from 'vitest';

import { getUserIdFromApiKey } from './apiKey';

afterEach(() => vi.restoreAllMocks());

describe('API key validation', () => {
  it.each([
    { status: 503, body: '<html>unavailable</html>', retryable: true },
    { status: 429, body: '{"error":"rate limited"}', retryable: true },
    { status: 401, body: '{"error":"invalid key"}', retryable: false },
    { status: 403, body: '<html>forbidden</html>', retryable: false },
    { status: 200, body: 'invalid JSON', retryable: true },
    { status: 200, body: '{}', retryable: true },
    { status: 200, body: '{"success":false}', retryable: false },
  ])('classifies HTTP $status ($body)', async ({ status, body, retryable }) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status }));
    await expect(getUserIdFromApiKey('fixture-key', 'http://localhost:1234')).rejects.toMatchObject(
      {
        name: 'ApiKeyValidationError',
        retryable,
      },
    );
  });

  it('classifies a network failure as retryable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(getUserIdFromApiKey('fixture-key', 'http://localhost:1234')).rejects.toMatchObject(
      {
        name: 'ApiKeyValidationError',
        message: 'fetch failed',
        retryable: true,
      },
    );
  });

  it('returns the current user for a valid API key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: { id: 'user-1' } }));
    await expect(getUserIdFromApiKey('fixture-key', 'http://localhost:1234')).resolves.toBe(
      'user-1',
    );
  });
});
