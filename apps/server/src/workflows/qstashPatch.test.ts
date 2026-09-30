import assert from 'node:assert/strict';

import { Client, QstashError } from '@upstash/qstash';
import { afterEach, describe, it, vi } from 'vitest';

/**
 * @example A patched QStash install preserves response context for failed publishes.
 */
describe('QStash package patch', () => {
  afterEach(() => vi.restoreAllMocks());

  // ROOT CAUSE:
  //
  // The repository patches a generated QStash bundle to log failed HTTP responses.
  // QStash 2.12.0 renamed that bundle, so the old patch failed during installation.
  // The refreshed patch must still emit the response context after installation.
  /**
   * @example A synthetic HTTP 400 reports the status, headers, and response body.
   */
  it('keeps detailed diagnostics for failed publishes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('synthetic bad request', {
        headers: { 'x-test': 'diagnostic' },
        status: 400,
      }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = new Client({
      baseUrl: 'https://qstash.invalid',
      retry: { retries: 0 },
      token: 'synthetic-token',
    });

    await assert.rejects(
      client.publishJSON({ body: { test: true }, url: 'https://destination.invalid' }),
      (error: unknown) => error instanceof QstashError && error.status === 400,
    );

    const diagnostic = errorSpy.mock.calls.find(
      ([message]) => message === '[upstash-qstash] request failed',
    );
    assert.ok(diagnostic);
    assert.match(String(diagnostic[1]), /"status":400/);
    assert.match(String(diagnostic[1]), /"x-test":"diagnostic"/);
    assert.match(String(diagnostic[1]), /"body":"synthetic bad request"/);
  });
});
