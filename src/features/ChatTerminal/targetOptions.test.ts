import type { DeviceListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  buildTargetOptions,
  LOCAL_TARGET,
  resolveTerminalCwd,
  resolveTerminalDevice,
} from './targetOptions';

const device = (patch: Partial<DeviceListItem>) =>
  ({ deviceId: 'dev_1', ...patch }) as DeviceListItem;

describe('buildTargetOptions', () => {
  it('gives the local option a non-empty value so Select can render its label', () => {
    const [local] = buildTargetOptions([], 'This computer');

    expect(local).toEqual({ label: 'This computer', value: LOCAL_TARGET });
    expect(local.value).not.toBe('');
  });

  it('omits the local option without a label', () => {
    expect(buildTargetOptions([device({})])).toEqual([{ label: 'dev_1', value: 'dev_1' }]);
  });

  it('labels devices by friendly name, then hostname, then id', () => {
    const options = buildTargetOptions([
      device({ deviceId: 'a', friendlyName: 'Laptop', hostname: 'host-a' }),
      device({ deviceId: 'b', hostname: 'host-b' }),
      device({ deviceId: 'c' }),
    ]);

    expect(options.map((option) => option.label)).toEqual(['Laptop', 'host-b', 'c']);
  });
});

describe('resolveTerminalDevice', () => {
  const sg = device({ deviceId: 'dev_sg' });
  const jp = device({ deviceId: 'dev_jp' });
  const base = { listSettled: true, localAvailable: true, targets: [jp, sg] };

  it("follows the topic's device instead of this machine", () => {
    expect(resolveTerminalDevice({ ...base, topicDeviceId: 'dev_sg' })).toEqual({
      deviceId: 'dev_sg',
      ready: true,
    });
  });

  it("follows the topic's device on the web instead of the first device", () => {
    expect(
      resolveTerminalDevice({ ...base, localAvailable: false, topicDeviceId: 'dev_sg' }),
    ).toEqual({ deviceId: 'dev_sg', ready: true });
  });

  it("lets an explicit pick override the topic's device, including this machine", () => {
    expect(
      resolveTerminalDevice({ ...base, pick: { deviceId: 'dev_jp' }, topicDeviceId: 'dev_sg' }),
    ).toEqual({ deviceId: 'dev_jp', ready: true });
    expect(resolveTerminalDevice({ ...base, pick: {}, topicDeviceId: 'dev_sg' })).toEqual({
      deviceId: undefined,
      ready: true,
    });
  });

  it("waits for the device list before falling back from the topic's device", () => {
    expect(
      resolveTerminalDevice({ ...base, listSettled: false, targets: [], topicDeviceId: 'dev_sg' }),
    ).toEqual({ ready: false });
  });

  it('waits while the execution config may still change, unless the user picked', () => {
    expect(resolveTerminalDevice({ ...base, configLoading: true })).toEqual({ ready: false });
    expect(
      resolveTerminalDevice({ ...base, configLoading: true, pick: { deviceId: 'dev_jp' } }),
    ).toEqual({ deviceId: 'dev_jp', ready: true });
  });

  it("falls back when the topic's device cannot host a shell", () => {
    expect(resolveTerminalDevice({ ...base, targets: [jp], topicDeviceId: 'dev_sg' })).toEqual({
      ready: true,
    });
    expect(
      resolveTerminalDevice({
        ...base,
        localAvailable: false,
        targets: [jp],
        topicDeviceId: 'dev_sg',
      }),
    ).toEqual({ deviceId: 'dev_jp', ready: true });
  });

  it('cannot spawn on the web without any device', () => {
    expect(resolveTerminalDevice({ ...base, localAvailable: false, targets: [] })).toEqual({
      deviceId: undefined,
      ready: false,
    });
  });
});

describe('resolveTerminalCwd', () => {
  it("starts in the conversation's directory on the machine it lives on", () => {
    expect(
      resolveTerminalCwd({
        deviceDefaultCwd: '/home/b',
        terminalDeviceId: 'dev_b',
        workingDirectory: '/repo',
        workingDirectoryDeviceId: 'dev_b',
      }),
    ).toBe('/repo');
  });

  it("uses the device's own default when the shell opens on another machine", () => {
    expect(
      resolveTerminalCwd({
        deviceDefaultCwd: '/home/a',
        terminalDeviceId: 'dev_a',
        workingDirectory: '/repo-on-b',
        workingDirectoryDeviceId: 'dev_b',
      }),
    ).toBe('/home/a');
    expect(
      resolveTerminalCwd({
        deviceDefaultCwd: null,
        terminalDeviceId: undefined,
        workingDirectory: '/repo-on-b',
        workingDirectoryDeviceId: 'dev_b',
      }),
    ).toBeUndefined();
  });
});
