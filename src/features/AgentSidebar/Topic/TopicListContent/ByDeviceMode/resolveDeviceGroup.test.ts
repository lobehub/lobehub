import { describe, expect, it } from 'vitest';

import {
  findDeviceTopicDirectory,
  hasNamesakeDevice,
  resolveDeviceGroupName,
} from './resolveDeviceGroup';

const directories = [
  { deviceId: 'dev-a', id: 'dir-a-plain' },
  {
    deviceId: 'dev-a',
    id: 'dir-a-instance',
    environmentId: 'env-1',
    instanceId: 'ins-1',
    permission: 'readWrite',
  },
  {
    deviceId: 'dev-b',
    id: 'dir-b-instance',
    environmentId: 'env-1',
    instanceId: 'ins-2',
    permission: 'readWrite',
  },
];

describe('findDeviceTopicDirectory', () => {
  it('returns the instance-bound directory on the given device', () => {
    expect(findDeviceTopicDirectory(directories, 'dev-a')?.id).toBe('dir-a-instance');
    expect(findDeviceTopicDirectory(directories, 'dev-b')?.id).toBe('dir-b-instance');
  });

  it('returns undefined when the device has no instance-bound directory, even with a plain one', () => {
    expect(findDeviceTopicDirectory([{ deviceId: 'dev-c', id: 'dir-c-plain' }], 'dev-c')).toBe(
      undefined,
    );
  });

  /** @example Review: a read-only or unlinked directory was staged, so the first send was refused. */
  it('skips a directory that cannot run — read-only or without a linked environment', () => {
    const runnable = { deviceId: 'dev-d', environmentId: 'env-1', permission: 'readWrite' };
    const rows = [
      { ...runnable, id: 'dir-d-readonly', instanceId: 'ins-3', permission: 'read' },
      { ...runnable, environmentId: null, id: 'dir-d-unlinked', instanceId: 'ins-4' },
      { ...runnable, id: 'dir-d-ok', instanceId: 'ins-5' },
    ];

    expect(findDeviceTopicDirectory(rows, 'dev-d')?.id).toBe('dir-d-ok');
  });

  it('offers nothing on a device other than the one the agent is fixed to', () => {
    expect(findDeviceTopicDirectory(directories, 'dev-a', 'dev-b')).toBeUndefined();
    expect(findDeviceTopicDirectory(directories, 'dev-b', 'dev-b')?.id).toBe('dir-b-instance');
  });

  it("tries one machine's identities in order and starts on the first that can run", () => {
    expect(findDeviceTopicDirectory(directories, ['dev-missing', 'dev-b', 'dev-a'])?.id).toBe(
      'dir-b-instance',
    );
    expect(findDeviceTopicDirectory(directories, ['dev-a', 'dev-b'], 'dev-b')?.id).toBe(
      'dir-b-instance',
    );
  });

  it('returns undefined for groups without a device (favorites, unknown bucket)', () => {
    expect(findDeviceTopicDirectory(directories, undefined)).toBeUndefined();
    expect(findDeviceTopicDirectory(directories)).toBeUndefined();
  });
});

describe('resolveDeviceGroupName', () => {
  it('keeps the synthetic group title (e.g. favorites) instead of the unknown label', () => {
    expect(resolveDeviceGroupName({ title: 'Favorites', unknownLabel: 'Unknown device' })).toBe(
      'Favorites',
    );
  });

  it('prefers the directory name, then device friendly name, then hostname', () => {
    expect(
      resolveDeviceGroupName({
        deviceName: '测试 MacBook',
        friendlyName: 'Mac',
        hostname: 'macbook-test',
        unknownLabel: 'Unknown device',
      }),
    ).toBe('测试 MacBook');
    expect(
      resolveDeviceGroupName({ friendlyName: 'Mac', hostname: 'macbook-test', unknownLabel: 'x' }),
    ).toBe('Mac');
    expect(resolveDeviceGroupName({ hostname: 'macbook-test', unknownLabel: 'x' })).toBe(
      'macbook-test',
    );
    expect(resolveDeviceGroupName({ unknownLabel: 'Unknown device' })).toBe('Unknown device');
  });
});

describe('hasNamesakeDevice', () => {
  const devices = [
    { deviceId: 'laptop', friendlyName: null, hostname: 'mocha-laptop' },
    { deviceId: 'laptop-ws', friendlyName: null, hostname: 'mocha-laptop' },
    { deviceId: 'studio', friendlyName: 'Studio', hostname: 'mocha-laptop' },
  ];

  it('finds another device shown under the same name', () => {
    expect(
      hasNamesakeDevice({ devices, directories: [], name: 'mocha-laptop', ownIds: ['laptop'] }),
    ).toBe(true);
  });

  it("ignores this machine's own identities and devices shown under another name", () => {
    expect(
      hasNamesakeDevice({
        devices,
        directories: [],
        name: 'mocha-laptop',
        ownIds: ['laptop', 'laptop-ws'],
      }),
    ).toBe(false);
  });

  it('reads the name a project directory gives a device first', () => {
    expect(
      hasNamesakeDevice({
        devices,
        directories: [{ deviceId: 'studio', deviceName: 'mocha-laptop' }],
        name: 'mocha-laptop',
        ownIds: ['laptop', 'laptop-ws'],
      }),
    ).toBe(true);
  });
});
