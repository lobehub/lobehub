import { mkdtemp, readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as DiscoveryFileModule from '@/modules/appHandoff/discoveryFile';

const { fetchMock, homeDir } = vi.hoisted(() => ({ fetchMock: vi.fn(), homeDir: { value: '' } }));

vi.mock('@/utils/net-fetch', () => ({ netFetch: fetchMock }));
vi.mock('@/utils/protocol', () => ({ getProtocolScheme: () => 'lobehub-dev' }));
vi.mock('@/modules/appHandoff/discoveryFile', async (importOriginal) => {
  const actual = await importOriginal<typeof DiscoveryFileModule>();
  return {
    ...actual,
    removeDiscoveryFileSync: (channel: any) =>
      actual.removeDiscoveryFileSync(channel, actual.getDiscoveryDir(homeDir.value)),
    removeDiscoveryFile: (channel: any) =>
      actual.removeDiscoveryFile(channel, actual.getDiscoveryDir(homeDir.value)),
    writeDiscoveryFile: (entry: any) =>
      actual.writeDiscoveryFile(entry, actual.getDiscoveryDir(homeDir.value)),
  };
});

const { default: AppHandoffCtr } = await import('../AppHandoffCtr');
const { notifyDesktopSessionChanged } = await import('@/modules/appHandoff/sessionEvents');

const SERVER = 'https://app.example.com';

const remoteServer = {
  accessToken: 'desktop-access-token' as string | null,
  getAccessToken: vi.fn(async () => remoteServer.accessToken),
  getRemoteServerConfig: vi.fn(async () => ({
    active: true,
    storageMode: 'selfHost',
    remoteServerUrl: SERVER,
  })),
  getRemoteServerUrl: vi.fn(async () => SERVER),
  isRemoteServerConfigured: vi.fn(async () => true),
  isTokenExpiringSoon: vi.fn(() => false),
  refreshAccessToken: vi.fn(),
};

const createApp = () =>
  ({
    browserManager: { getMainWindow: () => undefined },
    getController: () => remoteServer,
    i18n: { ns: () => (key: string) => key },
    storeManager: { get: vi.fn(() => []), set: vi.fn() },
  }) as any;

const discoveryPath = () => path.join(homeDir.value, '.lobehub', 'desktop-handoff', 'dev.json');

const waitFor = async <T>(read: () => Promise<T>, accept: (value: T) => boolean) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = await read().catch(() => undefined as T);
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('condition not met');
};

const getStatus = (port: number) =>
  new Promise<{ body: any; status: number }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', path: '/app-handoff/v1/status', port }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ body: JSON.parse(data), status: res.statusCode ?? 0 }));
    });
    req.on('error', reject);
    req.end();
  });

let ctr: InstanceType<typeof AppHandoffCtr> | undefined;

beforeEach(async () => {
  homeDir.value = await mkdtemp(path.join(os.tmpdir(), 'handoff-home-'));
  remoteServer.accessToken = 'desktop-access-token';
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () =>
    Response.json({
      issuer: `${SERVER}/oidc`,
      sub: 'user_a',
      targets: [{ client_id: 'native-app', name: 'Native App', verification: {} }],
    }),
  );
});

afterEach(async () => {
  remoteServer.accessToken = null;
  notifyDesktopSessionChanged();
  await new Promise((resolve) => setTimeout(resolve, 50));
  ctr = undefined;
});

describe('AppHandoffCtr', () => {
  it('listens and publishes the discovery file while signed in, and withdraws both on sign-out', async () => {
    ctr = new AppHandoffCtr(createApp());
    ctr.afterAppReady();

    const discovery = await waitFor(
      async () => JSON.parse(await readFile(discoveryPath(), 'utf8')),
      (value) => !!value?.port,
    );
    expect(discovery).toEqual({
      channel: 'dev',
      issuer: `${SERVER}/oidc`,
      pid: process.pid,
      port: expect.any(Number),
      v: 1,
    });
    expect(JSON.stringify(discovery)).not.toContain('desktop-access-token');

    // The target list was read with the desktop app's own token, from its own server.
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}/oidc/handoff/native`,
      expect.objectContaining({
        headers: expect.objectContaining({ 'Oidc-Auth': 'desktop-access-token' }),
        method: 'GET',
      }),
    );

    const status = await getStatus(discovery.port);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ issuer: `${SERVER}/oidc`, signedIn: true });

    remoteServer.accessToken = null;
    notifyDesktopSessionChanged();

    await waitFor(
      () =>
        readFile(discoveryPath(), 'utf8').then(
          () => true,
          () => false,
        ),
      (exists) => exists === false,
    );
    await expect(getStatus(discovery.port)).rejects.toThrow();
  });

  it('removes the discovery file synchronously on quit', async () => {
    ctr = new AppHandoffCtr(createApp());
    ctr.afterAppReady();
    await waitFor(
      () =>
        readFile(discoveryPath(), 'utf8').then(
          () => true,
          () => false,
        ),
      (exists) => exists === true,
    );

    ctr.stopOnQuit();

    // No await between quit and the check: the file must already be gone.
    await expect(readFile(discoveryPath(), 'utf8')).rejects.toThrow();
  });

  it('stays closed when the server lists no handoff target', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ error: 'not_available' }, { status: 404 }),
    );
    ctr = new AppHandoffCtr(createApp());
    ctr.afterAppReady();

    await new Promise((resolve) => setTimeout(resolve, 150));
    await expect(readFile(discoveryPath(), 'utf8')).rejects.toThrow();
  });
});
