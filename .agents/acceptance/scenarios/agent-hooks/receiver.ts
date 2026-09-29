import { mkdir, open } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { fixtures, type ResponseFixture } from './responses';

/** Disposable test endpoint, never a product route. Use synthetic Agent inputs only. */
export async function startReceiver(options: {
  host?: string;
  log: string;
  port?: number;
  responses?: Record<string, ResponseFixture>;
}) {
  await mkdir(path.dirname(options.log), { recursive: true });
  const log = await open(options.log, 'ax', 0o600);
  let sequence = 0;
  const pending = new Set<Promise<void>>();
  const server = createServer((request, response) => {
    const task = (async () => {
      const route = new URL(request.url ?? '/', 'http://receiver.invalid').pathname;
      if (route === '/health' && request.method === 'GET') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ receiver: 'agent-hooks-d', status: 'ready' }));
        return;
      }
      const name = route.startsWith('/hooks/') ? route.slice(7) : '';
      const fixture = (options.responses ?? fixtures)[name];
      if (request.method !== 'POST' || !fixture) {
        response.writeHead(404).end();
        return;
      }
      const id = ++sequence;
      const startedAt = Date.now();
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      let event: unknown;
      try {
        // No request headers are recorded. Known secret fields are removed recursively.
        event = JSON.parse(raw, (key, value) =>
          /authorization|cookie|password|secret|api.?key|credential|finalState/i.test(key)
            ? '[redacted]'
            : value,
        );
      } catch {
        event = { invalidJson: true, bytes };
      }
      await log.appendFile(
        JSON.stringify({ id, name, phase: 'received', at: startedAt, event }) + '\n',
      );
      await delay(fixture.delayMs ?? 0);
      const closed = response.destroyed;
      if (!closed) {
        response.writeHead(fixture.status ?? 200, { 'content-type': 'application/json' });
        response.end(fixture.body);
      }
      await log.appendFile(
        JSON.stringify({
          id,
          name,
          phase: closed ? 'client-disconnected' : 'response-sent',
          at: Date.now(),
          elapsedMs: Date.now() - startedAt,
          status: fixture.status ?? 200,
        }) + '\n',
      );
    })();
    pending.add(task);
    void task
      .catch(() => {
        console.error('Receiver request failed; no request contents logged to stderr');
        if (!response.headersSent) response.writeHead(500);
        response.end();
      })
      .finally(() => pending.delete(task));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No receiver TCP address');
  return {
    url: `http://${options.host ?? '127.0.0.1'}:${address.port}`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      await Promise.allSettled(pending);
      await log.close();
    },
  };
}

if (import.meta.main) {
  if (!process.env.HOOK_RECEIVER_LOG) throw new Error('Set HOOK_RECEIVER_LOG to a new JSONL file');
  const receiver = await startReceiver({
    host: process.env.HOOK_RECEIVER_HOST,
    log: process.env.HOOK_RECEIVER_LOG,
    port: Number(process.env.HOOK_RECEIVER_PORT ?? 0),
  });
  console.info(JSON.stringify({ url: receiver.url, fixtureNames: Object.keys(fixtures) }));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void receiver.close().then(() => process.exit(0)));
  }
}
