import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';

import type { Hono } from 'hono';

import { drainAfterTasks } from './next-compat/context';

const DEFAULT_PORT = 3011;

export interface StandaloneOptions {
  host: string;
  keepAliveTimeoutMs: number;
  port: number;
  shutdownTimeoutMs: number;
}

const parseInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);

  return Number.isNaN(parsed) || parsed < 0 ? fallback : parsed;
};

export const resolveStandaloneOptions = (
  env: Record<string, string | undefined> = process.env,
): StandaloneOptions => ({
  host: env.HONO_HOST || (env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost'),
  keepAliveTimeoutMs: parseInteger(env.HONO_KEEP_ALIVE_TIMEOUT_MS, 65_000),
  port: parseInteger(env.HONO_PORT ?? env.PORT, DEFAULT_PORT),
  shutdownTimeoutMs: parseInteger(env.HONO_SHUTDOWN_TIMEOUT_MS, 10_000),
});

const normalizeRemoteAddress = (address: string | undefined) => address?.replace(/^::ffff:/, '');

const createRequest = (request: IncomingMessage, fallbackHost: string) => {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const remoteAddress = normalizeRemoteAddress(request.socket.remoteAddress);
  if (!headers.has('x-forwarded-for') && remoteAddress) {
    headers.set('x-forwarded-for', remoteAddress);
  }

  const protocol = headers.get('x-forwarded-proto') || 'http';
  const host = headers.get('host') || fallbackHost;
  const url = new URL(request.url || '/', `${protocol}://${host}`);

  const init: RequestInit & { duplex?: 'half' } = {
    headers,
    method: request.method,
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = Readable.toWeb(request) as ReadableStream<Uint8Array>;
    init.duplex = 'half';
  }

  return new Request(url, init);
};

const writeResponse = async (response: Response, outgoing: ServerResponse) => {
  outgoing.statusCode = response.status;
  outgoing.statusMessage = response.statusText;

  const setCookie = response.headers.getSetCookie();

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie' && setCookie.length > 0) return;
    outgoing.setHeader(key, value);
  });
  if (setCookie.length > 0) outgoing.setHeader('set-cookie', setCookie);

  if (!response.body) {
    outgoing.end();
    return;
  }

  Readable.fromWeb(response.body).pipe(outgoing);
};

export type ShutdownResult = 'closed' | 'timeout';

export const createStandaloneServer = (app: Hono, options: StandaloneOptions) => {
  const fallbackHost = `${options.host}:${options.port}`;
  const server = createServer((request, response) => {
    void (async () => {
      try {
        await writeResponse(await app.fetch(createRequest(request, fallbackHost)), response);
      } catch (error) {
        console.error('Hono standalone request failed:', error);
        response.statusCode = 500;
        response.end('Internal Server Error');
      }
    })();
  });

  server.keepAliveTimeout = options.keepAliveTimeoutMs;
  server.headersTimeout = options.keepAliveTimeoutMs + 1000;

  let closing: Promise<ShutdownResult> | undefined;

  const close = () => {
    closing ??= new Promise<ShutdownResult>((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), options.shutdownTimeoutMs);
      server.close(() => {
        void drainAfterTasks().then(() => {
          clearTimeout(timer);
          resolve('closed');
        });
      });
      server.closeIdleConnections();
    });

    return closing;
  };

  const listen = () =>
    new Promise<void>((resolve) => {
      server.listen(options.port, options.host, () => resolve());
    });

  return { close, listen, server };
};
