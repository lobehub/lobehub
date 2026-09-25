import { createServer as createHttpServer, type Server } from 'node:http';
import { type AddressInfo, connect, createServer, type Server as NetServer } from 'node:net';

import type { NetworkProxySettings } from '@lobechat/electron-client-ipc';
import { ProxyAgent, request } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type SocksHttpBridge, startSocksHttpBridge } from '../socksHttpBridge';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const listen = async <T extends NetServer | Server>(server: T): Promise<number> => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
};

/** Minimal no-auth SOCKS5 server that records every CONNECT destination. */
const createSocksServer = (destinations: string[]) =>
  createServer((client) => {
    client.once('data', () => {
      client.write(Buffer.from([0x05, 0x00]));
      client.once('data', (req) => {
        const atyp = req[3];
        let host: string;
        let offset: number;
        if (atyp === 0x03) {
          const length = req[4];
          host = req.subarray(5, 5 + length).toString();
          offset = 5 + length;
        } else {
          host = [...req.subarray(4, 8)].join('.');
          offset = 8;
        }
        const port = req.readUInt16BE(offset);
        destinations.push(`${host}:${port}`);

        const upstream = connect(port, host, () => {
          client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          upstream.pipe(client);
          client.pipe(upstream);
        });
        upstream.on('error', () => client.destroy());
        client.on('error', () => upstream.destroy());
      });
    });
  });

describe('startSocksHttpBridge', () => {
  let socksServer: NetServer;
  let target: Server;
  let bridge: SocksHttpBridge | undefined;
  let destinations: string[];
  let socksConfig: NetworkProxySettings;
  let targetPort: number;

  beforeEach(async () => {
    destinations = [];
    socksServer = createSocksServer(destinations);
    target = createHttpServer((_req, res) => res.end('hello through socks'));
    const socksPort = await listen(socksServer);
    targetPort = await listen(target);
    socksConfig = {
      enableProxy: true,
      proxyPort: String(socksPort),
      proxyRequireAuth: false,
      proxyServer: '127.0.0.1',
      proxyType: 'socks5',
    };
  });

  afterEach(async () => {
    await bridge?.close();
    bridge = undefined;
    await new Promise((resolve) => target.close(resolve));
    await new Promise((resolve) => socksServer.close(resolve));
  });

  it('tunnels an HTTP-proxy client through the SOCKS5 proxy', async () => {
    bridge = await startSocksHttpBridge(socksConfig);

    const response = await request(`http://127.0.0.1:${targetPort}/`, {
      dispatcher: new ProxyAgent({ uri: bridge.url }),
    });

    expect(response.statusCode).toBe(200);
    expect(await response.body.text()).toBe('hello through socks');
    expect(destinations).toEqual([`127.0.0.1:${targetPort}`]);
  });

  it('refuses clients without the bridge credential', async () => {
    bridge = await startSocksHttpBridge(socksConfig);
    const { origin } = new URL(bridge.url);

    await expect(
      request(`http://127.0.0.1:${targetPort}/`, { dispatcher: new ProxyAgent({ uri: origin }) }),
    ).rejects.toThrow(/407/);
    expect(destinations).toEqual([]);
  });
});
