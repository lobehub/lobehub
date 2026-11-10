import type { Server } from 'node:http';
import { createServer } from 'node:http';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimeoutError } from '../../utils/errorType';
import type * as WithTimeoutModule from '../../utils/withTimeout';
import { naive } from '../naive';

vi.mock('../../utils/withTimeout', async (importOriginal) => ({
  ...(await importOriginal<typeof WithTimeoutModule>()),
  DEFAULT_TIMEOUT: 300,
}));

const within = <T>(promise: Promise<T>, ms: number, label: string) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} did not happen within ${ms}ms`)), ms);
    }),
  ]);

/** Real socket tests: no fetch mocks. */
describe('naive crawler network boundary', () => {
  let server: Server;
  let base: string;
  let socketClosed: Promise<void>;

  beforeEach(async () => {
    server = createServer((req, res) => {
      socketClosed = new Promise((resolve) => req.socket.once('close', () => resolve()));
      // Headers arrive at once, then the body drips without ever ending.
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.write('<html><body>');
      const timer = setInterval(() => res.write('<p>drip</p>'), 50);
      res.once('close', () => clearInterval(timer));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    base = `http://127.0.0.1:${address.port}`;
    vi.stubEnv('SSRF_ALLOW_PRIVATE_IP_ADDRESS', '1');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('times out a body that keeps dripping after the headers arrive', async () => {
    await expect(
      within(naive(`${base}/page`, { filterOptions: {} }), 2000, 'the crawl timing out'),
    ).rejects.toBeInstanceOf(TimeoutError);
    await within(socketClosed, 2000, 'upstream socket close');
  });
});
