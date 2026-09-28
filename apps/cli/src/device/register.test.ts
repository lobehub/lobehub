import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { mintWorkspaceConnectToken } from './register';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe('mintWorkspaceConnectToken', () => {
  it('recovers from a transient network failure', async () => {
    let attempts = 0;
    const server = createServer((request, response) => {
      attempts += 1;
      if (attempts === 1) {
        request.socket.destroy();
        return;
      }

      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          result: {
            data: {
              json: { token: 'workspace-token', workspaceId: 'workspace-id' },
            },
          },
        }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const result = await mintWorkspaceConnectToken(
      {
        serverUrl: `http://127.0.0.1:${port}`,
        token: 'user-token',
        tokenType: 'jwt',
      },
      'workspace-id',
    );

    expect(result).toEqual({ token: 'workspace-token', workspaceId: 'workspace-id' });
    expect(attempts).toBe(2);
  });
});
