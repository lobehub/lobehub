import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

import type { NetworkProxySettings } from '@lobechat/electron-client-ipc';
import { socksConnector } from 'fetch-socks';

import { createLogger } from '@/utils/logger';

import { toSocksProxies } from './dispatcher';
import { ProxyUrlBuilder } from './urlBuilder';

const logger = createLogger('modules:networkProxy:socksHttpBridge');

const BRIDGE_USER = 'lobehub';

export interface SocksHttpBridge {
  close: () => Promise<void>;
  /** `http://user:token@127.0.0.1:<port>`, ready to use as HTTP(S)_PROXY. */
  url: string;
}

const parseAuthority = (authority = ''): { hostname: string; port: string } | undefined => {
  try {
    const { hostname, port } = new URL(`http://${authority}`);
    if (!hostname || !port) return undefined;
    // URL keeps IPv6 literals bracketed; the SOCKS client wants them bare.
    return { hostname: hostname.replace(/^\[(.*)\]$/, '$1'), port };
  } catch {
    return undefined;
  }
};

const rejectConnect = (socket: Socket, status: string, headers = '') => {
  socket.end(`HTTP/1.1 ${status}\r\n${headers}Connection: close\r\n\r\n`);
};

/**
 * Loopback HTTP CONNECT proxy that tunnels through the user's SOCKS5 proxy.
 *
 * Node's env-proxy mode (`NODE_USE_ENV_PROXY`) only understands HTTP(S)_PROXY,
 * so a Node child — the embedded CLI — cannot use a SOCKS5 proxy through
 * `ALL_PROXY`. Point its HTTP(S)_PROXY at this bridge instead; the SOCKS hop
 * reuses the same fetch-socks client as the main process dispatcher. The URL
 * carries a random credential so other local processes cannot borrow the
 * user's proxy while the bridge is up.
 */
export const startSocksHttpBridge = async (
  config: NetworkProxySettings,
): Promise<SocksHttpBridge> => {
  const connect = socksConnector(toSocksProxies(ProxyUrlBuilder.build(config)));
  const token = randomBytes(24).toString('base64url');
  const expectedAuth = Buffer.from(
    `Basic ${Buffer.from(`${BRIDGE_USER}:${token}`).toString('base64')}`,
  );
  const sockets = new Set<Socket>();

  const isAuthorized = (header: string | undefined) => {
    const actual = Buffer.from(header ?? '');
    return actual.length === expectedAuth.length && timingSafeEqual(actual, expectedAuth);
  };

  const server = createServer((_request, response) => {
    // Node's env proxy tunnels plain http:// targets with CONNECT too.
    response.writeHead(405, { Connection: 'close' }).end();
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  server.on('connect', (request, clientSocket: Socket, head: Buffer) => {
    clientSocket.on('error', () => undefined);

    if (!isAuthorized(request.headers['proxy-authorization'])) {
      rejectConnect(
        clientSocket,
        '407 Proxy Authentication Required',
        'Proxy-Authenticate: Basic realm="lobehub"\r\n',
      );
      return;
    }

    const target = parseAuthority(request.url);
    if (!target) {
      rejectConnect(clientSocket, '400 Bad Request');
      return;
    }

    connect(
      { hostname: target.hostname, port: target.port, protocol: 'http:' } as Parameters<
        typeof connect
      >[0],
      (error, upstream) => {
        if (error || !upstream) {
          logger.warn('SOCKS5 tunnel failed:', {
            error: error?.message,
            target: `${target.hostname}:${target.port}`,
          });
          rejectConnect(clientSocket, '502 Bad Gateway');
          return;
        }
        if (clientSocket.destroyed) {
          upstream.destroy();
          return;
        }

        const upstreamSocket = upstream as Socket;
        sockets.add(upstreamSocket);
        upstreamSocket.once('close', () => sockets.delete(upstreamSocket));
        upstreamSocket.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => upstreamSocket.destroy());
        clientSocket.once('close', () => upstreamSocket.destroy());
        upstreamSocket.once('close', () => clientSocket.destroy());

        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) upstreamSocket.write(head);
        upstreamSocket.pipe(clientSocket);
        clientSocket.pipe(upstreamSocket);
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const { port } = server.address() as AddressInfo;
  let closePromise: Promise<void> | undefined;

  return {
    close: () => {
      closePromise ??= new Promise((resolve) => {
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      });
      return closePromise;
    },
    url: `http://${BRIDGE_USER}:${token}@127.0.0.1:${port}`,
  };
};
