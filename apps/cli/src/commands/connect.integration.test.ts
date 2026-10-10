import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';

interface CliResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

const tempHomes: string[] = [];
const servers: Server[] = [];
const daemonHomes: string[] = [];

/** `config.getGlobalConfig` as the tRPC lambda router answers it. */
const globalConfigBody = (serverConfig: Record<string, unknown>) =>
  JSON.stringify({ result: { data: { json: { serverConfig } } } });

const unsignedJwt = (sub: string) =>
  [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub })).toString('base64url'),
    'signature',
  ].join('.');

const listen = async (server: Server) => {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
};

async function runCli(
  args: string[],
  home: string,
  extraEnv: Record<string, string> = {},
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'bun',
      [path.resolve(import.meta.dirname, '../index.ts'), ...args],
      {
        cwd: path.resolve(import.meta.dirname, '../..'),
        env: {
          ...process.env,
          HOME: home,
          LOBEHUB_CLI_API_KEY: '',
          LOBEHUB_CLI_HOME: '.lobehub',
          LOBEHUB_JWT: '',
          ...extraEnv,
        },
        timeout: 10_000,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          reject(error);
          return;
        }

        resolve({
          exitCode: typeof error?.code === 'number' ? error.code : 0,
          stderr,
          stdout,
        });
      },
    );
  });
}

afterEach(async () => {
  // Never leave a daemon behind, even when an assertion failed.
  await Promise.all(daemonHomes.splice(0).map((home) => runCli(['connect', 'stop'], home)));
  await new Promise((resolve) => setTimeout(resolve, 100));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  await Promise.all(tempHomes.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('connect daemon startup', () => {
  it('reports a startup failure instead of claiming the daemon started', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'lobehub-cli-daemon-startup-'));
    tempHomes.push(home);
    const configDir = path.join(home, '.lobehub');
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, 'daemon.log'), '─'.repeat(512));

    const result = await runCli(['connect', '--daemon'], home);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain('Daemon started');
    expect(result.stderr).toContain('No authentication found');
  });

  it('surfaces the underlying network error when startup retries are exhausted', async () => {
    const portProbe = createServer();
    await new Promise<void>((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
    const { port } = portProbe.address() as AddressInfo;
    await new Promise<void>((resolve, reject) =>
      portProbe.close((error) => (error ? reject(error) : resolve())),
    );

    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'test-user' })).toString('base64url');
    const home = await mkdtemp(path.join(os.tmpdir(), 'lobehub-cli-daemon-startup-'));
    tempHomes.push(home);

    const result = await runCli(['connect', '--workspace', 'workspace-id', '--daemon'], home, {
      LOBEHUB_JWT: `${header}.${payload}.signature`,
      LOBEHUB_SERVER: `http://127.0.0.1:${port}`,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain('Daemon started');
    expect(result.stderr).toContain('ConnectionRefused');
  }, 15_000);

  it('does not report startup readiness before workspace registration succeeds', async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? '');
      response.setHeader('Content-Type', 'application/json');

      if (request.url?.includes('config.getGlobalConfig')) {
        response.end(globalConfigBody({ deviceGatewayUrl: 'http://127.0.0.1:9/gateway' }));
        return;
      }

      if (request.url?.includes('device.mintWorkspaceConnectToken')) {
        response.end(
          JSON.stringify({
            result: {
              data: {
                json: { token: 'workspace-token', workspaceId: 'workspace-id' },
              },
            },
          }),
        );
        return;
      }

      response.statusCode = 409;
      response.end(
        JSON.stringify({
          error: {
            json: {
              code: -32_009,
              data: {
                code: 'CONFLICT',
                httpStatus: 409,
                path: 'device.registerWorkspaceDevice',
              },
              message: 'workspace registration rejected',
            },
          },
        }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'test-user' })).toString('base64url');
    const home = await mkdtemp(path.join(os.tmpdir(), 'lobehub-cli-daemon-startup-'));
    tempHomes.push(home);

    const result = await runCli(
      ['connect', '--workspace', 'workspace-id', '--public', '--daemon'],
      home,
      {
        LOBEHUB_JWT: `${header}.${payload}.signature`,
        LOBEHUB_SERVER: `http://127.0.0.1:${port}`,
      },
    );

    expect(requests.some((url) => url.includes('device.registerWorkspaceDevice'))).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain('Daemon started');
    expect(result.stderr).toContain('workspace registration rejected');
  });

  it('fails fast when a self-hosted server advertises no gateway and none is saved', async () => {
    const port = await listen(
      createServer((request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          request.url?.includes('config.getGlobalConfig')
            ? globalConfigBody({})
            : JSON.stringify({ result: { data: { json: null } } }),
        );
      }),
    );
    const home = await mkdtemp(path.join(os.tmpdir(), 'lobehub-cli-daemon-startup-'));
    tempHomes.push(home);

    const result = await runCli(['connect', '--daemon'], home, {
      LOBEHUB_JWT: unsignedJwt('test-user'),
      LOBEHUB_SERVER: `http://127.0.0.1:${port}`,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain('Daemon started');
    expect(result.stderr).toContain('does not advertise a device gateway');
  });

  it('connects the daemon to the advertised gateway, path prefix included', async () => {
    const gatewayServer = createServer();
    const sockets = new WebSocketServer({ server: gatewayServer });
    const handshakes: { auth: any; path: string }[] = [];
    sockets.on('connection', (socket, request) => {
      socket.once('message', (data) => {
        handshakes.push({ auth: JSON.parse(String(data)), path: request.url ?? '' });
        socket.send(JSON.stringify({ type: 'auth_success' }));
      });
    });
    const gatewayPort = await listen(gatewayServer);

    const serverPort = await listen(
      createServer((request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          request.url?.includes('config.getGlobalConfig')
            ? globalConfigBody({ deviceGatewayUrl: `http://127.0.0.1:${gatewayPort}/edge/gw` })
            : JSON.stringify({ result: { data: { json: null } } }),
        );
      }),
    );
    const serverUrl = `http://127.0.0.1:${serverPort}`;
    const home = await mkdtemp(path.join(os.tmpdir(), 'lobehub-cli-daemon-startup-'));
    tempHomes.push(home);
    daemonHomes.push(home);
    const token = unsignedJwt('test-user');

    const result = await runCli(['connect', '--daemon'], home, {
      LOBEHUB_JWT: token,
      LOBEHUB_SERVER: serverUrl,
    });
    expect(result.stdout).toContain('Daemon started');

    for (let waited = 0; handshakes.length === 0 && waited < 5000; waited += 100) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // This login's token reached the gateway its own server advertised.
    expect(handshakes[0]?.path).toMatch(/^\/edge\/gw\/ws\?/);
    expect(handshakes[0]?.auth).toMatchObject({ serverUrl, token, type: 'auth' });

    const status = await runCli(['connect', 'status'], home);
    expect(status.stdout).toContain(`http://127.0.0.1:${gatewayPort}/edge/gw (server)`);
    sockets.close();
  }, 20_000);

  it('remembers --gateway for that server and reuses it ahead of the advertised one', async () => {
    const gatewayServer = createServer();
    const sockets = new WebSocketServer({ server: gatewayServer });
    const paths: string[] = [];
    sockets.on('connection', (socket, request) => {
      socket.once('message', () => {
        paths.push(request.url ?? '');
        socket.send(JSON.stringify({ type: 'auth_success' }));
      });
    });
    const gatewayPort = await listen(gatewayServer);

    let configReads = 0;
    const serverPort = await listen(
      createServer((request, response) => {
        if (request.url?.includes('config.getGlobalConfig')) configReads += 1;
        response.setHeader('Content-Type', 'application/json');
        response.end(
          request.url?.includes('config.getGlobalConfig')
            ? globalConfigBody({ deviceGatewayUrl: `http://127.0.0.1:${gatewayPort}/advertised` })
            : JSON.stringify({ result: { data: { json: null } } }),
        );
      }),
    );
    const env = {
      LOBEHUB_JWT: unsignedJwt('test-user'),
      LOBEHUB_SERVER: `http://127.0.0.1:${serverPort}`,
    };
    const home = await mkdtemp(path.join(os.tmpdir(), 'lobehub-cli-daemon-startup-'));
    tempHomes.push(home);
    daemonHomes.push(home);

    const waitForHandshakes = async (count: number) => {
      for (let waited = 0; paths.length < count && waited < 5000; waited += 100) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };

    const pinned = `http://127.0.0.1:${gatewayPort}/pinned`;
    const first = await runCli(['connect', '--daemon', '--gateway', pinned], home, env);
    expect(first.stdout).toContain('Daemon started');
    await waitForHandshakes(1);
    await runCli(['connect', 'stop'], home);

    // No --gateway: the saved address wins and the server is not asked.
    const second = await runCli(['connect', '--daemon'], home, env);
    expect(second.stdout).toContain('Daemon started');
    await waitForHandshakes(2);

    expect(paths.map((url) => url.split('?')[0])).toEqual(['/pinned/ws', '/pinned/ws']);
    expect(configReads).toBe(0);
    const status = await runCli(['connect', 'status'], home);
    expect(status.stdout).toContain(`${pinned} (manual)`);
    sockets.close();
  }, 30_000);
});
