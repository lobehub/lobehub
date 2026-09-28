import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../probes', () => ({
  probeCredential: async () => ({
    serverUrl: 'https://app.lobehub.com',
    token: 't',
    tokenType: 'jwt',
    userId: 'u',
  }),
  probeDevices: async () => state.devices,
}));

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
