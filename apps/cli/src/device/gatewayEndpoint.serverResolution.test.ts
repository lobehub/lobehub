import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RefreshModule from '../auth/refresh';
import { getValidToken } from '../auth/refresh';
import { resolveToken } from '../auth/resolveToken';
import { resolveCliDirName } from '../constants/identity';
import { resolveCliDeviceGateway } from './gatewayEndpoint';

/**
 * The whole chain a device command runs — credential → `auth.serverUrl` →
 * saved address → discovery → default — with the real settings file. Only the
 * network lookup and the stored-token store are stubbed, so a wrong default
 * shows up as a result here instead of as a socket to the official gateway.
 */

const tmpHome = path.join(os.tmpdir(), 'lobehub-cli-test-gateway-server');
const settingsFile = path.join(tmpHome, resolveCliDirName(), 'settings.json');

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    default: {
      ...actual.default,
      homedir: () => path.join(actual.default.tmpdir(), 'lobehub-cli-test-gateway-server'),
    },
  };
});

const getGlobalConfig = vi.fn();
const lookedUp: string[] = [];
vi.mock('../api/client', () => ({
  createPublicLambdaClient: vi.fn((serverUrl: string) => {
    lookedUp.push(serverUrl);
    return { config: { getGlobalConfig: { query: getGlobalConfig } } };
  }),
}));

vi.mock('../auth/refresh', async (importOriginal) => ({
  ...(await importOriginal<typeof RefreshModule>()),
  getValidToken: vi.fn(),
}));

const unsignedJwt = (sub: string) =>
  [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub })).toString('base64url'),
    'signature',
  ].join('.');

const SELF_HOSTED = 'https://self.example.com';
const OFFICIAL_GATEWAY = 'https://device-gateway.lobehub.com';

const writeSettings = (settings: Record<string, unknown>) => {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings));
};

const resolveFor = async () => {
  const auth = await resolveToken({});
  return { auth, gateway: await resolveCliDeviceGateway({ serverUrl: auth.serverUrl }) };
};

describe('device gateway for the server the credential is used against', () => {
  const originalServer = process.env.LOBEHUB_SERVER;
  const originalJwt = process.env.LOBEHUB_JWT;

  beforeEach(() => {
    fs.mkdirSync(tmpHome, { recursive: true });
    delete process.env.LOBEHUB_SERVER;
    delete process.env.LOBEHUB_JWT;
    lookedUp.length = 0;
    getGlobalConfig.mockReset();
    vi.mocked(getValidToken).mockResolvedValue({
      credentials: { accessToken: unsignedJwt('user-1') },
      status: 'ok',
    } as any);
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { force: true, recursive: true });
    process.env.LOBEHUB_SERVER = originalServer;
    process.env.LOBEHUB_JWT = originalJwt;
  });

  it.each([
    ['the stored login', () => {}],
    [
      'LOBEHUB_JWT',
      () => {
        process.env.LOBEHUB_JWT = unsignedJwt('user-1');
      },
    ],
  ])(
    'treats a server set only through LOBEHUB_SERVER as self-hosted with %s',
    async (_label, useCredential) => {
      // The saved login is official cloud (no serverUrl), and the address it
      // saved belongs to official cloud.
      writeSettings({ gatewayUrl: 'http://127.0.0.1:8788' });
      process.env.LOBEHUB_SERVER = `${SELF_HOSTED}/`;
      useCredential();
      getGlobalConfig.mockResolvedValue({ serverConfig: {} });

      const { auth, gateway } = await resolveFor();

      expect(auth.serverUrl).toBe(SELF_HOSTED);
      expect(lookedUp).toEqual([SELF_HOSTED]);
      // Neither the official gateway nor official cloud's saved address.
      expect(gateway).toEqual({ ok: false, reason: 'not_configured' });
    },
  );

  it('uses what a LOBEHUB_SERVER-only self-hosted server advertises', async () => {
    writeSettings({ gatewayUrl: 'http://127.0.0.1:8788' });
    process.env.LOBEHUB_SERVER = SELF_HOSTED;
    getGlobalConfig.mockResolvedValue({
      serverConfig: { deviceGatewayUrl: 'https://gw.self.example.com/' },
    });

    await expect(resolveFor()).resolves.toMatchObject({
      gateway: { endpoint: { source: 'server', url: 'https://gw.self.example.com' }, ok: true },
    });
  });

  it('uses the address saved for that self-hosted server without asking it', async () => {
    writeSettings({ deviceGatewayUrls: { [SELF_HOSTED]: 'https://gw.saved.example.com' } });
    process.env.LOBEHUB_SERVER = SELF_HOSTED;

    await expect(resolveFor()).resolves.toMatchObject({
      gateway: { endpoint: { source: 'manual', url: 'https://gw.saved.example.com' }, ok: true },
    });
    expect(lookedUp).toEqual([]);
  });

  it('keeps the official default for official cloud when it advertises nothing', async () => {
    process.env.LOBEHUB_SERVER = 'https://app.lobehub.com/';
    getGlobalConfig.mockResolvedValue({ serverConfig: {} });

    await expect(resolveFor()).resolves.toMatchObject({
      gateway: { endpoint: { source: 'official', url: OFFICIAL_GATEWAY }, ok: true },
    });
  });
});
