import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';

import honoModule from './index';

interface HonoFetchApp {
  fetch: (request: Request) => Promise<Response> | Response;
}

interface HonoModule {
  default?: unknown;
}

type HonoStandaloneGlobal = typeof globalThis & {
  __lobeHonoStandaloneServer?: Server;
};

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 3011;

const isHonoFetchApp = (value: unknown): value is HonoFetchApp =>
  typeof value === 'object' &&
  value !== null &&
  'fetch' in value &&
  typeof value.fetch === 'function';

const resolveApp = (): HonoFetchApp => {
  if (isHonoFetchApp(honoModule)) return honoModule;

  const defaultExport = (honoModule as HonoModule).default;
  if (isHonoFetchApp(defaultExport)) return defaultExport;

  throw new TypeError('Hono standalone entry did not resolve to a fetch-compatible app');
};

const app = resolveApp();

const resolvePort = () => {
  const parsed = Number.parseInt(process.env.HONO_PORT ?? process.env.PORT ?? '', 10);

  return Number.isNaN(parsed) ? DEFAULT_PORT : parsed;
};

const createRequest = (request: IncomingMessage) => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const protocol = headers.get('x-forwarded-proto') || 'http';
  const host = headers.get('host') || `${DEFAULT_HOST}:${resolvePort()}`;
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

  const setCookie = (
    response.headers as Headers & {
      getSetCookie?: () => string[];
    }
  ).getSetCookie?.();

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie' && setCookie?.length) return;
    outgoing.setHeader(key, value);
  });
  if (setCookie?.length) outgoing.setHeader('set-cookie', setCookie);

  if (!response.body) {
    outgoing.end();
    return;
  }

  Readable.fromWeb(response.body).pipe(outgoing);
};

const host = process.env.HONO_HOST || DEFAULT_HOST;
const port = resolvePort();

process.title = `lobe-hono-${port}`;

const server = createServer((request, response) => {
  void (async () => {
    try {
      await writeResponse(await app.fetch(createRequest(request)), response);
    } catch (error) {
      console.error('Hono standalone request failed:', error);
      response.statusCode = 500;
      response.end('Internal Server Error');
    }
  })();
});

const closePreviousServer = (previousServer: Server | undefined) =>
  new Promise<void>((resolve) => {
    if (!previousServer?.listening) {
      resolve();
      return;
    }

    previousServer.close(() => resolve());
  });

const startServer = async () => {
  const standaloneGlobal = globalThis as HonoStandaloneGlobal;

  await closePreviousServer(standaloneGlobal.__lobeHonoStandaloneServer);
  standaloneGlobal.__lobeHonoStandaloneServer = server;

  server.listen(port, host, () => {
    console.info(`Hono runtime ready at http://${host}:${port}`);
  });
};

void startServer().catch((error) => {
  console.error('Failed to start Hono runtime:', error);
  process.exitCode = 1;
});
