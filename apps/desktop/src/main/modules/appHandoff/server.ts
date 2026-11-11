import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { APP_HANDOFF_MAX_BODY_BYTES, APP_HANDOFF_PATHS, AppHandoffError } from './protocol';

export interface AppHandoffHttpRequest {
  body?: unknown;
  /** The caller's source port: the key to resolve which process connected. */
  remotePort: number;
  route: keyof typeof APP_HANDOFF_PATHS;
}

export type AppHandoffHttpHandler = (
  request: AppHandoffHttpRequest,
) => Promise<{ body: unknown; status?: number }>;

export interface AppHandoffServer {
  close: () => Promise<void>;
  port: number;
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::ffff:127.0.0.1']);

/** Headers a browser attaches to every request it makes on a page's behalf. */
const BROWSER_HEADERS = ['origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'];

const ROUTES: Record<string, { method: string; route: keyof typeof APP_HANDOFF_PATHS }> = {
  [APP_HANDOFF_PATHS.code]: { method: 'POST', route: 'code' },
  [APP_HANDOFF_PATHS.status]: { method: 'GET', route: 'status' },
};

const send = (res: ServerResponse, status: number, body: unknown) => {
  const text = JSON.stringify(body);
  // No CORS headers, ever: a page that manages to reach the port still cannot read a response.
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  res.end(text);
};

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let size = 0;
    let overflow = false;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > APP_HANDOFF_MAX_BODY_BYTES) {
        // Keep draining (and discarding) so the caller still receives the error response.
        overflow = true;
        chunks.length = 0;
        return;
      }
      if (!overflow) chunks.push(chunk);
    });
    req.on('end', () => {
      if (overflow) reject(new AppHandoffError('invalid_request', 'body is too large'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });

/**
 * Checks everything that can be decided from the request alone, before any
 * process lookup: it came over IPv4 loopback, names this exact host and port
 * (DNS rebinding sends another Host), carries none of the headers a browser
 * adds for a web page, and is a JSON body of bounded size.
 */
export const guardRequest = async (req: IncomingMessage, port: number) => {
  if (!LOOPBACK_ADDRESSES.has(req.socket.remoteAddress ?? '')) {
    throw new AppHandoffError('forbidden', 'not a loopback connection');
  }
  if (req.headers.host !== `127.0.0.1:${port}`) {
    throw new AppHandoffError('forbidden', 'unexpected Host header');
  }
  if (BROWSER_HEADERS.some((header) => req.headers[header] !== undefined)) {
    throw new AppHandoffError('forbidden', 'browser requests are not accepted');
  }

  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const entry = ROUTES[url.pathname];
  if (!entry) throw new AppHandoffError('not_found', 'unknown endpoint');
  if (req.method !== entry.method)
    throw new AppHandoffError('method_not_allowed', 'method not allowed');

  if (entry.method !== 'POST') return { route: entry.route };

  const contentType = req.headers['content-type']?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    throw new AppHandoffError('invalid_request', 'body must be application/json');
  }
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > APP_HANDOFF_MAX_BODY_BYTES) {
    throw new AppHandoffError('invalid_request', 'body is too large');
  }
  const text = await readBody(req);
  try {
    return { body: JSON.parse(text) as unknown, route: entry.route };
  } catch {
    throw new AppHandoffError('invalid_request', 'body is not valid JSON');
  }
};

/**
 * Starts the loopback interface on `127.0.0.1` and an OS-assigned port. Never
 * binds another interface: the handoff is only for processes on this machine.
 */
export const startAppHandoffServer = async (
  handle: AppHandoffHttpHandler,
  { onError }: { onError?: (error: unknown) => void } = {},
): Promise<AppHandoffServer> => {
  let port = 0;

  const server: Server = createServer(async (req, res) => {
    try {
      const { body, route } = await guardRequest(req, port);
      const result = await handle({ body, remotePort: req.socket.remotePort ?? 0, route });
      send(res, result.status ?? 200, result.body);
    } catch (error) {
      if (error instanceof AppHandoffError) {
        send(res, error.status, error.toJSON());
        return;
      }
      onError?.(error);
      send(res, 502, { error: 'server_error', error_description: 'handoff failed' });
    }
  });
  // Bound the time a caller can hold a connection open.
  server.requestTimeout = 90_000;
  server.headersTimeout = 10_000;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
    port,
  };
};
