import type * as DeviceGatewayClientModule from '@lobechat/device-gateway-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '../../api/client';
import type * as SettingsModule from '../../settings';
import type * as ProbesModule from '../probes';
import { makeContext, runCheck } from '../testUtils';
import { deviceChecks } from './device';

const state = vi.hoisted(() => ({
  daemonPid: null as number | null,
  daemonStatus: null as any,
  devices: [] as any[],
  localDeviceId: undefined as string | undefined,
}));

const removePid = vi.hoisted(() => vi.fn());
const removeStatus = vi.hoisted(() => vi.fn());

vi.mock('../../daemon/manager', () => ({
  getRunningDaemonPid: () => state.daemonPid,
  readStatus: () => state.daemonStatus,
  removePid,
  removeStatus,
}));

vi.mock('../../service/connect', () => ({
  readConnectServiceStatus: () => {
    throw new Error('not systemd');
  },
}));

vi.mock('../../utils/device', () => ({ resolveLocalDeviceId: () => state.localDeviceId }));

const credentialServer = vi.hoisted(() => ({ value: 'https://app.lobehub.com' }));

vi.mock('../probes', async (importOriginal) => ({
  // `probeDeviceGateway` stays real: the check must resolve like `lh connect`.
  ...(await importOriginal<typeof ProbesModule>()),
  probeCredential: async () => ({
    serverUrl: credentialServer.value,
    token: 't',
    tokenType: 'jwt',
    userId: 'u',
  }),
  probeDevices: async () => state.devices,
}));

const getGlobalConfig = vi.hoisted(() => vi.fn());
const createPublicLambdaClient = vi.hoisted(() =>
  vi.fn(() => ({ config: { getGlobalConfig: { query: getGlobalConfig } } })),
);
vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClientModule>()),
  createPublicLambdaClient,
}));

const savedGateway = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('../../settings', async (importOriginal) => ({
  ...(await importOriginal<typeof SettingsModule>()),
  loadDeviceGatewayUrl: () => savedGateway.value,
}));

const gatewayClients = vi.hoisted(() => [] as any[]);
vi.mock('@lobechat/device-gateway-client', async (importOriginal) => ({
  ...(await importOriginal<typeof DeviceGatewayClientModule>()),
  GatewayClient: vi.fn().mockImplementation(function (options: any) {
    const listeners: Record<string, (...args: any[]) => void> = {};
    const client = {
      connect: vi.fn(async () => listeners.connected?.()),
      disconnect: vi.fn(),
      on: (event: string, listener: (...args: any[]) => void) => {
        listeners[event] = listener;
      },
      options,
    };
    gatewayClients.push(client);
    return client;
  }),
}));

describe('device.gateway', () => {
  const SELF_HOSTED = 'https://lobe.internal';

  beforeEach(() => {
    gatewayClients.length = 0;
    credentialServer.value = SELF_HOSTED;
    savedGateway.value = undefined;
    getGlobalConfig.mockReset();
    createPublicLambdaClient.mockClear();
  });

  it("handshakes with the gateway the credential's server advertises", async () => {
    getGlobalConfig.mockResolvedValue({
      serverConfig: { deviceGatewayUrl: 'https://gw.lobe.internal/edge/' },
    });

    const outcome = await runCheck(deviceChecks, 'device.gateway', makeContext());

    expect(createPublicLambdaClient).toHaveBeenCalledWith(SELF_HOSTED);
    expect(gatewayClients.map((client) => client.options.gatewayUrl)).toEqual([
      'https://gw.lobe.internal/edge',
    ]);
    expect(outcome).toMatchObject({
      detail: 'Authenticated to https://gw.lobe.internal/edge (advertised by the server).',
      evidence: { gatewaySource: 'server', serverUrl: SELF_HOSTED },
      status: 'ok',
    });
  });

  it('handshakes with the address saved for that server ahead of its advertisement', async () => {
    savedGateway.value = 'http://127.0.0.1:8788';
    getGlobalConfig.mockResolvedValue({
      serverConfig: { deviceGatewayUrl: 'https://gw.lobe.internal/edge/' },
    });

    const outcome = await runCheck(deviceChecks, 'device.gateway', makeContext());

    expect(getGlobalConfig).not.toHaveBeenCalled();
    expect(gatewayClients.map((client) => client.options.gatewayUrl)).toEqual([
      'http://127.0.0.1:8788',
    ]);
    expect(outcome).toMatchObject({
      detail: 'Authenticated to http://127.0.0.1:8788 (saved for this server).',
      evidence: { gatewaySource: 'manual', serverUrl: SELF_HOSTED },
      status: 'ok',
    });
  });

  it('says how to configure a self-hosted server that advertises no gateway', async () => {
    getGlobalConfig.mockResolvedValue({ serverConfig: {} });

    const outcome = await runCheck(deviceChecks, 'device.gateway', makeContext());

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('does not advertise a device gateway');
    expect(outcome.fix).toContain('--gateway <url>');
    expect(gatewayClients).toHaveLength(0);
  });

  it('fails a broken lookup instead of probing a default', async () => {
    getGlobalConfig.mockRejectedValue(new Error('INTERNAL_SERVER_ERROR'));

    const outcome = await runCheck(deviceChecks, 'device.gateway', makeContext());

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('Could not read the device gateway address');
    expect(gatewayClients).toHaveLength(0);
  });
});

describe('device.daemon', () => {
  beforeEach(() => {
    state.daemonPid = null;
    state.daemonStatus = null;
  });

  it('survives a platform without the connect service', async () => {
    const outcome = await runCheck(deviceChecks, 'device.daemon');

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('No connect daemon');
  });

  it('flags a status file with no daemon behind it', async () => {
    state.daemonStatus = {
      connectionStatus: 'connected',
      deviceId: 'dev_1',
      gatewayUrl: 'wss://gw',
      pid: 4,
      startedAt: '',
    };

    const outcome = await runCheck(deviceChecks, 'device.daemon');

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('left over');
  });

  it('does not call a live daemon connected without its own report', async () => {
    state.daemonPid = 42;
    state.daemonStatus = null;

    const outcome = await runCheck(deviceChecks, 'device.daemon');

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('has not reported a connection state');
  });

  it('reports a healthy daemon', async () => {
    state.daemonPid = 42;
    state.daemonStatus = {
      connectionStatus: 'connected',
      deviceId: 'dev_1',
      gatewayUrl: 'wss://gw',
      pid: 42,
      startedAt: '',
    };

    const outcome = await runCheck(deviceChecks, 'device.daemon');

    expect(outcome.status).toBe('ok');
    expect(outcome.detail).toContain('dev_1');
  });

  it('flags a daemon whose last known state was not connected', async () => {
    state.daemonPid = 42;
    state.daemonStatus = {
      connectionStatus: 'reconnecting',
      deviceId: 'dev_1',
      gatewayUrl: 'wss://gw',
      pid: 42,
      startedAt: '',
    };

    const outcome = await runCheck(deviceChecks, 'device.daemon');

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('reconnecting');
  });
});

describe('device.registration', () => {
  beforeEach(() => {
    state.devices = [];
    state.localDeviceId = undefined;
  });

  it('fails when this machine has never connected and nothing else is online', async () => {
    const outcome = await runCheck(deviceChecks, 'device.registration', makeContext());

    expect(outcome.status).toBe('fail');
  });

  it('only warns when other devices are online', async () => {
    state.devices = [{ deviceId: 'dev_other', online: true }];

    const outcome = await runCheck(deviceChecks, 'device.registration', makeContext());

    expect(outcome.status).toBe('warn');
  });

  it('fails when the local device is registered but offline', async () => {
    state.localDeviceId = 'dev_local';
    state.devices = [{ deviceId: 'dev_local', online: false }];

    const outcome = await runCheck(deviceChecks, 'device.registration', makeContext());

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('offline');
  });

  it('passes when the local device is online', async () => {
    state.localDeviceId = 'dev_local';
    state.devices = [{ deviceId: 'dev_local', online: true }];

    const outcome = await runCheck(deviceChecks, 'device.registration', makeContext());

    expect(outcome.status).toBe('ok');
  });
});
